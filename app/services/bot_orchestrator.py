"""
Bot Orchestrator Service.

Manages thread pool for running accounts in parallel with event callbacks.
Decoupled from UI - uses callbacks/queues for status updates.
Integrates scheduler, database tracking, and notifications.
"""

import logging
import random
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor, Future
from queue import Queue
from typing import Callable, Dict, List, Optional

from app.config import settings
from app.core.automation import FacebookAutomation
from app.core.browser import BrowserManager
from app.database import db
from app.models import Account, AccountStatus, ActionType, BatchResult, TaskConfig, TaskResult
from app.notifications import notifier
from app.scheduler import scheduler
from app.services.account_manager import AccountManager


class BotOrchestrator:
    """
    Orchestrates bot execution across multiple accounts.

    Manages worker threads, assigns tasks, and provides callbacks
    for UI updates without direct UI dependencies.

    Attributes:
        account_manager: AccountManager instance.
        browser_manager: BrowserManager instance.
        logger: Logger instance.
        is_running: Whether the orchestrator is currently running.
    """

    def __init__(
        self,
        account_manager: AccountManager,
        browser_manager: Optional[BrowserManager] = None,
        logger: Optional[logging.Logger] = None
    ) -> None:
        """
        Initialize BotOrchestrator.

        Args:
            account_manager: AccountManager instance.
            browser_manager: Optional BrowserManager instance.
            logger: Optional logger instance.
        """
        self.account_manager = account_manager
        self.browser_manager = browser_manager or BrowserManager()
        self.logger = logger or logging.getLogger(__name__)

        self.is_running = False
        self.is_paused = False
        self._stop_flag = threading.Event()
        self._pause_flag = threading.Event()
        self._lock = threading.Lock()
        self._executor: Optional[ThreadPoolExecutor] = None

        # Current task configuration
        self.task_config: Optional[TaskConfig] = None

        # Event callbacks
        self._on_log: Optional[Callable[[str], None]] = None
        self._on_account_start: Optional[Callable[[Account], None]] = None
        self._on_account_complete: Optional[Callable[[Account, TaskResult], None]] = None
        self._on_batch_start: Optional[Callable[[int, List[Account]], None]] = None
        self._on_batch_complete: Optional[Callable[[BatchResult], None]] = None
        self._on_all_complete: Optional[Callable[[List[BatchResult]], None]] = None
        self._on_status_change: Optional[Callable[[str], None]] = None

        # Message queue for thread-safe logging
        self.log_queue: Queue = Queue()

    def set_callbacks(
        self,
        on_log: Optional[Callable[[str], None]] = None,
        on_account_start: Optional[Callable[[Account], None]] = None,
        on_account_complete: Optional[Callable[[Account, TaskResult], None]] = None,
        on_batch_start: Optional[Callable[[int, List[Account]], None]] = None,
        on_batch_complete: Optional[Callable[[BatchResult], None]] = None,
        on_all_complete: Optional[Callable[[List[BatchResult]], None]] = None,
        on_status_change: Optional[Callable[[str], None]] = None
    ) -> None:
        """
        Set callback functions for events.

        Args:
            on_log: Called with log messages.
            on_account_start: Called when account processing starts.
            on_account_complete: Called when account processing completes.
            on_batch_start: Called when batch starts.
            on_batch_complete: Called when batch completes.
            on_all_complete: Called when all batches complete.
            on_status_change: Called with status updates.
        """
        self._on_log = on_log
        self._on_account_start = on_account_start
        self._on_account_complete = on_account_complete
        self._on_batch_start = on_batch_start
        self._on_batch_complete = on_batch_complete
        self._on_all_complete = on_all_complete
        self._on_status_change = on_status_change

    def _log(self, message: str, level: int = logging.INFO) -> None:
        """Log a message and emit to callback."""
        self.logger.log(level, message)
        self.log_queue.put(message)
        if self._on_log:
            try:
                self._on_log(message)
            except Exception:
                pass

    def _emit_status(self, status: str) -> None:
        """Emit status change event."""
        if self._on_status_change:
            try:
                self._on_status_change(status)
            except Exception:
                pass

    def _is_chrome_running(self, port: int, host: str = "127.0.0.1") -> bool:
        """
        Check if Chrome is running and listening on the specified port.

        Args:
            port: The debugging port to check.
            host: The host address (default: 127.0.0.1).

        Returns:
            True if Chrome is running on the port, False otherwise.
        """
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(2)
                return s.connect_ex((host, port)) == 0
        except Exception:
            return False

    def _wait_if_paused(self) -> bool:
        """
        Block until unpaused or stopped.

        Returns:
            True if should continue, False if stopped.
        """
        while self._pause_flag.is_set():
            if self._stop_flag.is_set():
                return False
            time.sleep(0.5)
        return not self._stop_flag.is_set()

    def _attempt_auto_login(
        self,
        account: Account,
        driver,
        automation: "FacebookAutomation"
    ) -> bool:
        """
        Attempt automatic login for an account with expired session.

        Args:
            account: Account that needs re-login.
            driver: WebDriver instance.
            automation: FacebookAutomation instance.

        Returns:
            True if login successful, False otherwise.
        """
        from utils.crypto import decrypt_password, has_credentials
        from datetime import datetime

        # Check if account has stored credentials
        if not has_credentials(account):
            self._log(
                f"[AUTO-LOGIN] No credentials stored for {account.debugger_address}. "
                f"Please add FB email/password in account settings.",
                logging.WARNING
            )
            account.set_logged_out()
            notifier.notify_login_required(account.debugger_address)
            return False

        # Check if max retries reached
        if account.login_attempts >= settings.max_login_retries:
            self._log(
                f"[AUTO-LOGIN] Max login retries ({settings.max_login_retries}) "
                f"reached for {account.debugger_address}",
                logging.ERROR
            )
            account.set_login_failed("Max retries exceeded")
            return False

        # Increment attempt counter
        account.login_attempts += 1
        self._log(
            f"[AUTO-LOGIN] Attempting login for {account.debugger_address} "
            f"(attempt {account.login_attempts}/{settings.max_login_retries})...",
            logging.INFO
        )

        # Decrypt credentials
        try:
            email = account.fb_email
            password = decrypt_password(account.fb_password_enc)
        except Exception as e:
            self._log(f"[AUTO-LOGIN] Failed to decrypt credentials: {e}", logging.ERROR)
            account.set_error("Credential decryption failed")
            return False

        # Perform login
        login_result = automation.perform_login(email, password)

        if login_result == "success":
            self._log(
                f"[AUTO-LOGIN] Login successful for {account.debugger_address}! "
                f"Waiting {settings.login_success_wait}s before continuing...",
                logging.INFO
            )
            account.set_login_success()

            # Send Telegram notification
            if settings.notify_on_login:
                notifier.notify_login_success(account.debugger_address)

            # Wait to avoid suspicious activity
            for _ in range(settings.login_success_wait):
                if self._stop_flag.is_set():
                    return False
                time.sleep(1)

            return True

        elif login_result == "2fa":
            self._log(
                f"[AUTO-LOGIN] 2FA/Checkpoint required for {account.debugger_address}. "
                f"Manual action needed.",
                logging.WARNING
            )
            account.set_checkpoint()
            notifier.notify_checkpoint(account.debugger_address)
            return False

        elif login_result == "disabled":
            self._log(
                f"[AUTO-LOGIN] Account {account.debugger_address} is DISABLED! "
                f"This account cannot be used.",
                logging.ERROR
            )
            account.set_checkpoint()  # Use checkpoint status for disabled accounts
            account.error_message = "Account disabled"
            notifier.notify_checkpoint(account.debugger_address)  # Notify as critical issue
            return False

        elif login_result == "wrong_pass":
            self._log(
                f"[AUTO-LOGIN] Wrong credentials for {account.debugger_address}. "
                f"Please update the password.",
                logging.ERROR
            )
            account.set_login_failed("Wrong email/password")
            notifier.notify_login_failed(account.debugger_address, "Wrong credentials")
            return False

        else:  # "timeout" or "error"
            self._log(
                f"[AUTO-LOGIN] Login result uncertain ({login_result}) for "
                f"{account.debugger_address}. Will retry next run.",
                logging.WARNING
            )
            account.set_error(f"Auto-login failed: {login_result}")
            return False

    def _process_account(
        self,
        account: Account,
        account_logger: Optional[Callable[[str], None]] = None,
        task_config: Optional[TaskConfig] = None
    ) -> TaskResult:
        """
        Process a single account with daily limits and database tracking.

        Args:
            account: Account to process.
            account_logger: Optional per-account log callback.
            task_config: Optional task configuration (uses self.task_config if not provided).

        Returns:
            TaskResult with outcome.
        """
        if self._stop_flag.is_set():
            return TaskResult(account=account, error="Stopped")

        if self._on_account_start:
            try:
                self._on_account_start(account)
            except Exception:
                pass

        # Use provided task_config or fall back to instance config
        config = task_config or self.task_config

        # Check daily limit (only for INVITE action)
        daily_remaining = None
        if config is None or config.action_type == ActionType.INVITE:
            daily_limit = settings.daily_max_invites
            if settings.warmup_enabled:
                original_limit = daily_limit
                warmup_limit = db.get_warmup_limit(account.debugger_address, daily_limit)
                warmup_level = db.get_warmup_level(account.debugger_address) if hasattr(db, 'get_warmup_level') else "?"
                if warmup_limit != original_limit:
                    self._log(
                        f"[WARMUP] Level {warmup_level}/10: Limit constrained "
                        f"{original_limit} -> {warmup_limit} for {account.debugger_address}",
                        logging.WARNING
                    )
                    daily_limit = warmup_limit

            daily_remaining = db.get_daily_remaining(account.debugger_address, daily_limit)
            self._log(f"Daily remaining for {account.debugger_address}: {daily_remaining}/{daily_limit}")
            
            if daily_remaining <= 0:
                self._log(f"Account {account.debugger_address} reached daily limit")
                account.set_error("Daily limit reached")
                return TaskResult(account=account, error="Daily limit reached")

        # Pre-check: Is Chrome running on this port?
        if not self._is_chrome_running(account.port):
            error_msg = f"Chrome NOT running on port {account.port}. Please start Chrome with remote debugging on this port first."
            self._log(f"[ERROR] {error_msg}", logging.ERROR)
            account.set_error(f"Chrome not running on port {account.port}")
            return TaskResult(account=account, error=f"Chrome not running on port {account.port}")

        # Get WebDriver
        driver = self.browser_manager.get_driver(account.port)
        if not driver:
            error_msg = f"Failed to connect WebDriver for {account.debugger_address}. Chrome may be running but WebDriver cannot attach."
            self._log(f"[ERROR] {error_msg}", logging.ERROR)
            account.set_error("Failed to connect WebDriver")
            result = TaskResult(account=account, error="WebDriver connection failed")
            return result

        self._log(f"Processing {account.debugger_address}...")

        # Create automation instance
        automation = FacebookAutomation(
            driver=driver,
            logger=self.logger,
            on_log=account_logger
        )

        # Check for checkpoint/disabled BEFORE checking logged out state
        # This is important because checkpoint pages can look like login pages
        try:
            # We first check if the browser is already on a facebook page. If not, go to facebook.com to evaluate session.
            current_url = driver.current_url
            if "facebook.com" not in current_url.lower():
                driver.get("https://www.facebook.com/")
                time.sleep(2)
        except Exception:
            pass

        # CRITICAL: Check checkpoint/disabled FIRST before any login attempts
        if automation.check_checkpoint():
            self._log(f"[CHECKPOINT] Account {account.debugger_address} requires checkpoint/disabled!", logging.WARNING)
            account.set_checkpoint()
            db.record_checkpoint(account.debugger_address)
            notifier.notify_checkpoint(account.debugger_address)
            result = TaskResult(account=account, error="Checkpoint")
            if self._on_account_complete:
                try:
                    self._on_account_complete(account, result)
                except Exception:
                    pass
            return result

        is_logged_out = automation.check_logged_out()
        if is_logged_out:
            if getattr(settings, 'auto_login_enabled', False):
                self._log(f"[WARN] {account.debugger_address} is logged out. Attempting auto-login...")
                login_ok = self._attempt_auto_login(account, driver, automation)
                if not login_ok:
                    result = TaskResult(account=account, error=account.error_message or "Auto-login failed")
                    if self._on_account_complete:
                        try:
                            self._on_account_complete(account, result)
                        except Exception:
                            pass
                    return result
                # Login OK - recreate automation instance and verify no checkpoint
                automation = FacebookAutomation(
                    driver=driver,
                    logger=self.logger,
                    on_log=account_logger
                )
                # Post-login checkpoint check (sometimes checkpoint appears AFTER login)
                time.sleep(1)
                if automation.check_checkpoint():
                    self._log(f"[CHECKPOINT] Post-login checkpoint detected for {account.debugger_address}!", logging.WARNING)
                    account.set_checkpoint()
                    db.record_checkpoint(account.debugger_address)
                    notifier.notify_checkpoint(account.debugger_address)
                    result = TaskResult(account=account, error="Checkpoint after login")
                    if self._on_account_complete:
                        try:
                            self._on_account_complete(account, result)
                        except Exception:
                            pass
                    return result
            else:
                error_msg = "Account is logged out and auto-login is disabled."
                self._log(f"[ERROR] {error_msg}", logging.ERROR)
                account.set_error("Logged out")
                result = TaskResult(account=account, error=error_msg)
                if self._on_account_complete:
                    try:
                        self._on_account_complete(account, result)
                    except Exception:
                        pass
                return result

        # Process based on task configuration
        if config:
            # Use new task-based processing
            result = automation.process_task(account, config, daily_remaining=daily_remaining)
        else:
            # Legacy mode: process as invite task
            result = automation.process_account(account, daily_remaining=daily_remaining)

        # Record to database (for INVITE and UNFOLLOW actions)
        if result.invites_sent > 0:
            if config is None or config.action_type in [ActionType.INVITE, ActionType.UNFOLLOW]:
                db.record_invites(
                    account.debugger_address,
                    result.invites_sent,
                    config.target_url if config else account.group_url
                )

        # Check for checkpoint and notify
        if result.error == "Checkpoint":
            db.record_checkpoint(account.debugger_address)
            notifier.notify_checkpoint(account.debugger_address)

        # Emit completion event
        if self._on_account_complete:
            try:
                self._on_account_complete(account, result)
            except Exception:
                pass

        return result

    def _take_random_break(self) -> bool:
        """
        Possibly take a random break for anti-detection.

        Returns:
            True if break was taken.
        """
        if not settings.random_breaks_enabled:
            return False

        if random.randint(1, 100) <= settings.break_chance_percent:
            break_time = random.randint(
                settings.break_duration_min,
                settings.break_duration_max
            )
            self._log(f"Taking random break for {break_time}s (anti-detection)")
            self._emit_status(f"Break ({break_time}s)")

            for _ in range(break_time):
                if self._stop_flag.is_set():
                    return True
                time.sleep(1)
            return True
        return False

    def _process_sequential_group(
        self,
        group_num: int,
        accounts: List[Account],
        account_loggers: Dict[str, Callable[[str], None]] = None
    ) -> List[TaskResult]:
        """
        Process a small group of accounts sequentially with proper browser management.

        Opens browsers, processes accounts in parallel within the group,
        then closes all browsers before returning.

        Args:
            group_num: Group number for logging.
            accounts: Accounts in this group (typically 2).
            account_loggers: Optional per-account log callbacks.

        Returns:
            List of TaskResults.
        """
        account_loggers = account_loggers or {}
        results = []

        self._log(f"--- Group {group_num}: Processing {len(accounts)} accounts ---")

        # Refresh proxies for accounts that need them
        for account in accounts:
            if not account.proxy or account.status == AccountStatus.PROXY_DEAD:
                self.account_manager.refresh_proxy(account)

        # Start Chrome instances for this group only
        started = self.browser_manager.start_accounts(accounts)
        if started == 0:
            self._log(f"Failed to start Chrome for group {group_num}", logging.ERROR)
            for account in accounts:
                results.append(TaskResult(account=account, error="Chrome start failed"))
            return results

        self._log(f"Started {started} browsers for group {group_num}")

        # Process accounts in parallel within this small group
        futures: Dict[Future, Account] = {}

        try:
            self._log(f"Starting ThreadPoolExecutor for {len(accounts)} accounts...")
            with ThreadPoolExecutor(max_workers=len(accounts)) as executor:
                for account in accounts:
                    if self._stop_flag.is_set():
                        break

                    self._log(f"Submitting task for {account.debugger_address}")
                    logger_callback = account_loggers.get(account.debugger_address)
                    future = executor.submit(
                        self._process_account,
                        account,
                        logger_callback
                    )
                    futures[future] = account

                # Collect results
                for future in futures:
                    if self._stop_flag.is_set():
                        break

                    try:
                        self._log(f"Waiting for result from {futures[future].debugger_address}...")
                        result = future.result(timeout=600)  # 10 min timeout per account
                        self._log(f"Result for {futures[future].debugger_address}: success={result.success}, invites={result.invites_sent}, error={result.error}")
                        results.append(result)
                    except Exception as e:
                        account = futures[future]
                        self._log(f"Error processing {account.debugger_address}: {e}", logging.ERROR)
                        results.append(TaskResult(account=account, error=str(e)))

        finally:
            # ALWAYS close browsers after this group finishes
            if settings.close_browser_after_account:
                self._log(f"Closing browsers for group {group_num}")
                self.browser_manager.stop_accounts(accounts)

        return results

    def _process_batch(
        self,
        batch_num: int,
        accounts: List[Account],
        account_loggers: Dict[str, Callable[[str], None]] = None
    ) -> BatchResult:
        """
        Process a batch of accounts using sequential group processing.

        Processes accounts in small groups (concurrent_browsers at a time),
        closing browsers between groups to manage resources.

        Args:
            batch_num: Batch number.
            accounts: Accounts in this batch.
            account_loggers: Optional per-account log callbacks.

        Returns:
            BatchResult with batch outcome.
        """
        account_loggers = account_loggers or {}
        start_time = time.time()

        batch_result = BatchResult(
            batch_number=batch_num,
            total_accounts=len(accounts)
        )

        self._log(f"=== Batch {batch_num}: Processing {len(accounts)} accounts ===")
        self._emit_status(f"Batch {batch_num}: Starting")

        if self._on_batch_start:
            try:
                self._on_batch_start(batch_num, accounts)
            except Exception:
                pass

        # Split accounts into small groups based on concurrent_browsers setting
        concurrent = settings.concurrent_browsers
        groups = [
            accounts[i:i + concurrent]
            for i in range(0, len(accounts), concurrent)
        ]

        self._log(f"Processing in {len(groups)} groups of {concurrent} browsers each")

        group_num = 0
        for group in groups:
            if self._stop_flag.is_set():
                self._log("Stop requested, ending batch")
                break

            # Check for pause
            if not self._wait_if_paused():
                self._log("Stop requested while paused, ending batch")
                break

            group_num += 1

            # Process this group
            group_results = self._process_sequential_group(
                group_num, group, account_loggers
            )

            # Collect results
            for result in group_results:
                batch_result.results.append(result)
                if result.success:
                    batch_result.successful += 1
                    batch_result.total_invites += result.invites_sent
                else:
                    batch_result.failed += 1

            # Rest between groups (except last)
            if group_num < len(groups) and not self._stop_flag.is_set():
                # Maybe take a random break
                if not self._take_random_break():
                    # Normal rest between account groups
                    rest_time = random.randint(
                        settings.rest_between_accounts,
                        settings.rest_between_accounts + 30
                    )
                    self._log(f"Resting {rest_time}s before next group...")
                    self._emit_status(f"Resting ({rest_time}s)")

                    for _ in range(rest_time):
                        if self._stop_flag.is_set():
                            break
                        # Check for pause during rest
                        if self._pause_flag.is_set():
                            if not self._wait_if_paused():
                                break
                        time.sleep(1)

        batch_result.duration = time.time() - start_time
        self._log(
            f"Batch {batch_num} complete: "
            f"{batch_result.successful}/{batch_result.total_accounts} successful, "
            f"{batch_result.total_invites} invites in {batch_result.duration:.1f}s"
        )

        # Send Telegram notification
        notifier.notify_batch_complete(
            batch_num,
            batch_result.successful,
            batch_result.failed,
            batch_result.total_invites,
            batch_result.duration
        )

        if self._on_batch_complete:
            try:
                self._on_batch_complete(batch_result)
            except Exception:
                pass

        return batch_result

    def set_task_config(self, task_config: TaskConfig) -> None:
        """
        Set the task configuration for the next run.

        Args:
            task_config: Task configuration to use.
        """
        self.task_config = task_config
        self._log(f"Task config set: {task_config.action_label}")

    def run(
        self,
        accounts: List[Account] = None,
        batch_size: int = None,
        account_loggers: Dict[str, Callable[[str], None]] = None,
        wait_for_schedule: bool = True,
        task_config: Optional[TaskConfig] = None,
        skip_error_accounts: bool = True,
        retry_checkpoint: bool = False
    ) -> List[BatchResult]:
        """
        Run the bot across all accounts in batches.

        Args:
            accounts: Accounts to process (default: all from manager).
            batch_size: Accounts per batch.
            account_loggers: Optional per-account log callbacks.
            wait_for_schedule: Whether to wait for scheduler window.
            task_config: Optional task configuration for all accounts.
            skip_error_accounts: Skip accounts with ERROR status (default: True).
            retry_checkpoint: Also retry accounts with CHECKPOINT status (default: False).

        Returns:
            List of BatchResults.
        """
        if self.is_running:
            self._log("Orchestrator already running", logging.WARNING)
            return []

        with self._lock:
            self.is_running = True
            self._stop_flag.clear()
            self._pause_flag.clear()

        # Set task config if provided
        if task_config:
            self.task_config = task_config

        # Check scheduler
        if settings.scheduler_enabled and wait_for_schedule:
            if not scheduler.can_run():
                self._log("Outside scheduled time window")
                self._emit_status("Waiting for schedule")

                # Wait for schedule window
                if not scheduler.wait_for_window(
                    check_interval=60,
                    on_waiting=lambda s: self._emit_status(f"Scheduled: {s}")
                ):
                    self._log("Scheduler wait interrupted")
                    with self._lock:
                        self.is_running = False
                    return []

        # Reset daily warmup counters at start of day
        db.reset_daily_warmup()

        accounts = accounts or self.account_manager.get_all_accounts()
        batch_size = batch_size or settings.batch_size
        account_loggers = account_loggers or {}
        all_results: List[BatchResult] = []

        # Filter accounts by status before running
        original_count = len(accounts)
        runnable_statuses = [AccountStatus.IDLE, AccountStatus.OK, AccountStatus.PROXY_DEAD]

        # Add ERROR status if not skipping
        if not skip_error_accounts:
            runnable_statuses.append(AccountStatus.ERROR)

        # Add CHECKPOINT status if retry_checkpoint is True
        if retry_checkpoint:
            runnable_statuses.append(AccountStatus.CHECKPOINT)

        runnable_accounts = [a for a in accounts if a.status in runnable_statuses]
        skipped = original_count - len(runnable_accounts)

        if skipped > 0:
            skipped_error = len([a for a in accounts if a.status == AccountStatus.ERROR])
            skipped_checkpoint = len([a for a in accounts if a.status == AccountStatus.CHECKPOINT])
            self._log(
                f"Skipping {skipped} accounts: {skipped_error} ERROR, {skipped_checkpoint} CHECKPOINT. "
                f"Use 'Reset Status' to retry.",
                logging.WARNING
            )

        if not runnable_accounts:
            self._log("No runnable accounts found! All accounts are in ERROR/CHECKPOINT status.", logging.WARNING)
            self._emit_status("No accounts to run")
            with self._lock:
                self.is_running = False
            return []

        accounts = runnable_accounts

        # Log with task info
        task_label = self.task_config.action_label if self.task_config else "Invite Friends"
        self._log(f"Starting [{task_label}] with {len(accounts)} accounts (skipped {skipped}), batch size {batch_size}")
        self._emit_status(f"Starting: {task_label}")

        try:
            # Split into batches
            batches = [
                accounts[i:i + batch_size]
                for i in range(0, len(accounts), batch_size)
            ]

            for batch_num, batch in enumerate(batches, 1):
                if self._stop_flag.is_set():
                    self._log("Stop requested, ending run")
                    break

                # Process batch
                result = self._process_batch(batch_num, batch, account_loggers)
                all_results.append(result)

                # Save progress
                self.account_manager.save_accounts()

                # Rest between batches (except last)
                if batch_num < len(batches) and not self._stop_flag.is_set():
                    rest_time = random.randint(
                        settings.batch_rest_min,
                        settings.batch_rest_max
                    )
                    self._log(f"Resting {rest_time}s before next batch...")
                    self._emit_status(f"Resting ({rest_time}s)")

                    # Interruptible sleep
                    for _ in range(rest_time):
                        if self._stop_flag.is_set():
                            break
                        time.sleep(1)

            # Final summary
            total_invites = sum(r.total_invites for r in all_results)
            total_successful = sum(r.successful for r in all_results)
            total_failed = sum(r.failed for r in all_results)

            self._log(
                f"=== Run Complete ===\n"
                f"Batches: {len(all_results)}\n"
                f"Successful: {total_successful}\n"
                f"Failed: {total_failed}\n"
                f"Total Invites: {total_invites}"
            )
            self._emit_status("Complete")

            # Send run complete notification
            notifier.notify_run_complete(
                len(all_results),
                total_successful,
                total_failed,
                total_invites
            )

            if self._on_all_complete:
                try:
                    self._on_all_complete(all_results)
                except Exception:
                    pass

        except Exception as e:
            self._log(f"Critical error in run: {e}", logging.ERROR)
            self._emit_status("Error")

        finally:
            with self._lock:
                self.is_running = False

        return all_results

    def run_async(
        self,
        accounts: List[Account] = None,
        batch_size: int = None,
        account_loggers: Dict[str, Callable[[str], None]] = None
    ) -> threading.Thread:
        """
        Run the bot asynchronously in a background thread.

        Args:
            accounts: Accounts to process.
            batch_size: Accounts per batch.
            account_loggers: Optional per-account log callbacks.

        Returns:
            The background thread.
        """
        thread = threading.Thread(
            target=self.run,
            args=(accounts, batch_size, account_loggers),
            daemon=True
        )
        thread.start()
        return thread

    def run_loop(
        self,
        accounts: List[Account] = None,
        batch_size: int = None,
        account_loggers: Dict[str, Callable[[str], None]] = None,
        on_loop_complete: Optional[Callable[[int, List[BatchResult]], None]] = None
    ) -> None:
        """
        Run the bot in a loop at configured intervals.

        Runs until stopped or max_runs reached. Respects scheduler settings.

        Args:
            accounts: Accounts to process (default: all from manager).
            batch_size: Accounts per batch.
            account_loggers: Optional per-account log callbacks.
            on_loop_complete: Callback after each loop iteration (run_number, results).
        """
        if not settings.auto_loop_enabled:
            self._log("Auto loop is disabled in settings")
            return

        run_count = 0
        max_runs = settings.auto_loop_max_runs
        interval_minutes = settings.auto_loop_interval_minutes

        self._log(f"=== Starting Auto Loop ===")
        self._log(f"Interval: {interval_minutes} minutes")
        self._log(f"Max runs: {'Unlimited' if max_runs == 0 else max_runs}")
        self._emit_status("Auto Loop Active")

        self._stop_flag.clear()
        self._pause_flag.clear()

        while not self._stop_flag.is_set():
            # Check if max runs reached
            if max_runs > 0 and run_count >= max_runs:
                self._log(f"Reached max runs ({max_runs}), stopping loop")
                break

            run_count += 1
            self._log(f"\n{'='*50}")
            self._log(f"=== Auto Loop Run #{run_count} ===")
            self._log(f"{'='*50}")

            # Execute the run
            results = self.run(
                accounts=accounts,
                batch_size=batch_size,
                account_loggers=account_loggers,
                wait_for_schedule=True
            )

            # Callback for loop completion
            if on_loop_complete:
                try:
                    on_loop_complete(run_count, results)
                except Exception:
                    pass

            # Check if we should continue
            if self._stop_flag.is_set():
                self._log("Loop stopped by user")
                break

            if max_runs > 0 and run_count >= max_runs:
                self._log(f"Completed all {max_runs} scheduled runs")
                break

            # Wait for next interval
            next_run_time = interval_minutes * 60
            self._log(f"\nNext run in {interval_minutes} minutes...")
            self._emit_status(f"Next run in {interval_minutes}m")

            # Interruptible wait
            wait_start = time.time()
            while time.time() - wait_start < next_run_time:
                if self._stop_flag.is_set():
                    self._log("Loop interrupted during wait")
                    return

                # Update countdown every minute
                remaining = next_run_time - (time.time() - wait_start)
                remaining_mins = int(remaining / 60)
                if remaining_mins > 0 and int(remaining) % 60 == 0:
                    self._emit_status(f"Next run in {remaining_mins}m")

                time.sleep(1)

        self._log("=== Auto Loop Ended ===")
        self._emit_status("Loop Complete")

    def run_loop_async(
        self,
        accounts: List[Account] = None,
        batch_size: int = None,
        account_loggers: Dict[str, Callable[[str], None]] = None,
        on_loop_complete: Optional[Callable[[int, List[BatchResult]], None]] = None
    ) -> threading.Thread:
        """
        Run the auto-loop in a background thread.

        Args:
            accounts: Accounts to process.
            batch_size: Accounts per batch.
            account_loggers: Optional per-account log callbacks.
            on_loop_complete: Callback after each loop iteration.

        Returns:
            The background thread.
        """
        thread = threading.Thread(
            target=self.run_loop,
            args=(accounts, batch_size, account_loggers, on_loop_complete),
            daemon=True
        )
        thread.start()
        return thread

    def stop(self) -> None:
        """Request the orchestrator to stop."""
        self._log("Stop requested...")
        self._stop_flag.set()
        self._pause_flag.clear()  # Clear pause when stopping
        self._emit_status("Stopping")
        scheduler.stop()

    def pause(self) -> None:
        """Pause the orchestrator between accounts."""
        if self.is_running and not self.is_paused:
            self._pause_flag.set()
            self.is_paused = True
            self._emit_status("Paused")
            self._log("[PAUSE] Bot paused. Click Resume to continue.")

    def resume(self) -> None:
        """Resume from pause."""
        if self.is_paused:
            self._pause_flag.clear()
            self.is_paused = False
            self._emit_status("Resuming")
            self._log("[RESUME] Bot resumed.")

    def shutdown(self) -> None:
        """Stop and cleanup all resources."""
        self.stop()
        self.browser_manager.shutdown_all()
        self._log("Orchestrator shutdown complete")

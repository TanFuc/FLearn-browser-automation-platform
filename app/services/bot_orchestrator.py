"""
Bot Orchestrator Service.

Manages thread pool for running accounts in parallel with event callbacks.
Decoupled from UI - uses callbacks/queues for status updates.
Integrates scheduler, database tracking, and notifications.
"""

import logging
import random
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
        self._stop_flag = threading.Event()
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
                daily_limit = db.get_warmup_limit(account.debugger_address, daily_limit)

            daily_remaining = db.get_daily_remaining(account.debugger_address, daily_limit)
            if daily_remaining <= 0:
                self._log(f"Account {account.debugger_address} reached daily limit")
                account.set_error("Daily limit reached")
                return TaskResult(account=account, error="Daily limit reached")

        # Get WebDriver
        driver = self.browser_manager.get_driver(account.port)
        if not driver:
            account.set_error("Failed to connect to Chrome")
            result = TaskResult(account=account, error="WebDriver connection failed")
            return result

        # Create automation instance
        automation = FacebookAutomation(
            driver=driver,
            logger=self.logger,
            on_log=account_logger
        )

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

    def _process_batch(
        self,
        batch_num: int,
        accounts: List[Account],
        account_loggers: Dict[str, Callable[[str], None]] = None
    ) -> BatchResult:
        """
        Process a batch of accounts.

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

        # Refresh proxies for accounts that need them
        for account in accounts:
            if not account.proxy or account.status == AccountStatus.PROXY_DEAD:
                self.account_manager.refresh_proxy(account)

        # Start Chrome instances
        started = self.browser_manager.start_accounts(accounts)
        if started == 0:
            self._log("Failed to start any Chrome instances", logging.ERROR)
            batch_result.failed = len(accounts)
            return batch_result

        # Process accounts in parallel
        futures: Dict[Future, Account] = {}

        with ThreadPoolExecutor(max_workers=len(accounts)) as executor:
            for account in accounts:
                if self._stop_flag.is_set():
                    break

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
                    result = future.result(timeout=300)  # 5 min timeout
                    batch_result.results.append(result)

                    if result.success:
                        batch_result.successful += 1
                        batch_result.total_invites += result.invites_sent
                    else:
                        batch_result.failed += 1

                except Exception as e:
                    account = futures[future]
                    self._log(f"Task error for {account.debugger_address}: {e}", logging.ERROR)
                    batch_result.failed += 1

        # Stop Chrome instances
        self.browser_manager.stop_accounts(accounts)

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
        task_config: Optional[TaskConfig] = None
    ) -> List[BatchResult]:
        """
        Run the bot across all accounts in batches.

        Args:
            accounts: Accounts to process (default: all from manager).
            batch_size: Accounts per batch.
            account_loggers: Optional per-account log callbacks.
            wait_for_schedule: Whether to wait for scheduler window.
            task_config: Optional task configuration for all accounts.

        Returns:
            List of BatchResults.
        """
        if self.is_running:
            self._log("Orchestrator already running", logging.WARNING)
            return []

        with self._lock:
            self.is_running = True
            self._stop_flag.clear()

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

        # Log with task info
        task_label = self.task_config.action_label if self.task_config else "Invite Friends"
        self._log(f"Starting [{task_label}] with {len(accounts)} accounts, batch size {batch_size}")
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

    def stop(self) -> None:
        """Request the orchestrator to stop."""
        self._log("Stop requested...")
        self._stop_flag.set()
        self._emit_status("Stopping")

    def shutdown(self) -> None:
        """Stop and cleanup all resources."""
        self.stop()
        self.browser_manager.shutdown_all()
        self._log("Orchestrator shutdown complete")

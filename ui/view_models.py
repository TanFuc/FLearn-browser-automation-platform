"""
View Models Module.

Connects UI events to BotOrchestrator through callbacks.
Implements the MVVM pattern for clean separation of concerns.
"""

import logging
import threading
from datetime import datetime
from queue import Queue
from typing import Callable, Dict, List, Optional

from app.config import settings
from app.core.browser import BrowserManager
from app.core.proxy import ProxyManager
from app.models import Account, AccountStatus, ActionType, BatchResult, TaskConfig, TaskResult
from app.services.account_manager import AccountManager
from app.services.bot_orchestrator import BotOrchestrator


class MainViewModel:
    """
    View model for the main application window.

    Manages application state and provides methods for UI to interact
    with the underlying services.

    Attributes:
        account_manager: AccountManager instance.
        orchestrator: BotOrchestrator instance.
        is_running: Whether the bot is currently running.
    """

    def __init__(self) -> None:
        """Initialize the MainViewModel."""
        self.logger = logging.getLogger(__name__)

        # Initialize managers
        self.proxy_manager = ProxyManager(logger=self.logger)
        self.browser_manager = BrowserManager(logger=self.logger)
        self.account_manager = AccountManager(
            proxy_manager=self.proxy_manager,
            logger=self.logger
        )
        self.orchestrator = BotOrchestrator(
            account_manager=self.account_manager,
            browser_manager=self.browser_manager,
            logger=self.logger
        )

        # State
        self.is_running = False
        self._run_thread: Optional[threading.Thread] = None

        # Current task configuration
        self.current_action = ActionType.INVITE
        self.task_target_url = ""
        self.task_content = ""

        # UI callbacks
        self._on_log: Optional[Callable[[str], None]] = None
        self._on_account_log: Dict[str, Callable[[str], None]] = {}
        self._on_status_change: Optional[Callable[[str], None]] = None
        self._on_account_update: Optional[Callable[[Account], None]] = None
        self._on_run_complete: Optional[Callable[[List[BatchResult]], None]] = None

        # Message queue for thread-safe UI updates
        self.message_queue: Queue = Queue()

    def set_ui_callbacks(
        self,
        on_log: Optional[Callable[[str], None]] = None,
        on_status_change: Optional[Callable[[str], None]] = None,
        on_account_update: Optional[Callable[[Account], None]] = None,
        on_run_complete: Optional[Callable[[List[BatchResult]], None]] = None
    ) -> None:
        """
        Set UI callback functions.

        Args:
            on_log: Called with log messages for global log.
            on_status_change: Called with status changes.
            on_account_update: Called when account state changes.
            on_run_complete: Called when run completes.
        """
        self._on_log = on_log
        self._on_status_change = on_status_change
        self._on_account_update = on_account_update
        self._on_run_complete = on_run_complete

        # Configure orchestrator callbacks
        self.orchestrator.set_callbacks(
            on_log=self._handle_log,
            on_account_start=self._handle_account_start,
            on_account_complete=self._handle_account_complete,
            on_batch_complete=self._handle_batch_complete,
            on_all_complete=self._handle_run_complete,
            on_status_change=self._handle_status_change
        )

    def set_account_logger(
        self,
        account_address: str,
        callback: Callable[[str], None]
    ) -> None:
        """
        Set log callback for a specific account.

        Args:
            account_address: Account debugger address.
            callback: Log callback function.
        """
        self._on_account_log[account_address] = callback

    def _handle_log(self, message: str, level: int = None) -> None:
        """Handle log message from orchestrator or internal service."""
        timestamp = datetime.now().strftime("%H:%M:%S")
        formatted = f"[{timestamp}] {message}"

        if self._on_log:
            self.message_queue.put(("log", formatted))

    def _handle_status_change(self, status: str) -> None:
        """Handle status change from orchestrator."""
        if self._on_status_change:
            self.message_queue.put(("status", status))

    def _handle_account_start(self, account: Account) -> None:
        """Handle account processing start."""
        if self._on_account_update:
            self.message_queue.put(("account_update", account))

    def _handle_account_complete(self, account: Account, result: TaskResult) -> None:
        """Handle account processing completion."""
        if self._on_account_update:
            self.message_queue.put(("account_update", account))

    def _handle_batch_complete(self, result: BatchResult) -> None:
        """Handle batch completion."""
        self._handle_log(
            f"Batch {result.batch_number}: "
            f"{result.successful}/{result.total_accounts} OK, "
            f"{result.total_invites} invites"
        )

    def _handle_run_complete(self, results: List[BatchResult]) -> None:
        """Handle full run completion."""
        self.is_running = False

        total_invites = sum(r.total_invites for r in results)
        total_successful = sum(r.successful for r in results)

        self._handle_log(
            f"Run complete! "
            f"{total_successful} accounts successful, "
            f"{total_invites} total invites"
        )

        if self._on_run_complete:
            self.message_queue.put(("run_complete", results))

    def process_messages(self) -> None:
        """
        Process messages from the queue.

        Should be called periodically from the UI thread (e.g., via after()).
        """
        while not self.message_queue.empty():
            try:
                msg_type, data = self.message_queue.get_nowait()

                if msg_type == "log" and self._on_log:
                    self._on_log(data)
                elif msg_type == "status" and self._on_status_change:
                    self._on_status_change(data)
                elif msg_type == "account_update" and self._on_account_update:
                    self._on_account_update(data)
                elif msg_type == "run_complete" and self._on_run_complete:
                    self._on_run_complete(data)

            except Exception:
                pass

    def load_accounts(self) -> List[Account]:
        """
        Load accounts from file.

        Returns:
            List of loaded accounts.
        """
        return self.account_manager.load_accounts()

    def save_accounts(self) -> bool:
        """
        Save accounts to file.

        Returns:
            True if saved successfully.
        """
        return self.account_manager.save_accounts()

    def set_account_credentials(
        self,
        account: Account,
        email: str,
        password: Optional[str]
    ) -> bool:
        """
        Save encrypted credentials for an account.

        Args:
            account: Account to update.
            email: Facebook email/phone.
            password: Plaintext password (will be encrypted), or None to keep existing.

        Returns:
            True if saved successfully.
        """
        from utils.crypto import encrypt_password

        try:
            account.fb_email = email
            if password:  # Only update if new password provided
                account.fb_password_enc = encrypt_password(password)

            self.account_manager.save_accounts()
            self._handle_log(f"Credentials saved for {account.display_name}")
            return True
        except Exception as e:
            self._handle_log(f"Failed to save credentials: {e}", logging.ERROR)
            return False

    def clear_account_credentials(self, account: Account) -> None:
        """
        Remove stored credentials for an account.

        Args:
            account: Account to clear credentials for.
        """
        account.fb_email = None
        account.fb_password_enc = None
        account.login_attempts = 0
        self.account_manager.save_accounts()
        self._handle_log(f"Credentials cleared for {account.display_name}")

    def get_accounts(self) -> List[Account]:
        """
        Get all accounts.

        Returns:
            List of all accounts.
        """
        return self.account_manager.get_all_accounts()

    def get_account_by_address(self, debugger_address: str) -> Optional[Account]:
        """
        Get a single account by its debugger address.

        Args:
            debugger_address: Chrome remote debugger address (host:port).

        Returns:
            Account if found, None otherwise.
        """
        return self.account_manager.get_account(debugger_address)

    def add_account(
        self,
        debugger_address: str,
        group_url: Optional[str] = None,
        proxy: Optional["Proxy"] = None
    ) -> Account:
        """
        Add a new account.

        Args:
            debugger_address: Chrome debugger address.
            group_url: Optional Facebook group URL.
            proxy: Optional proxy for the account.

        Returns:
            Created account.
        """
        from app.models import Proxy
        account = Account(
            debugger_address=debugger_address,
            group_url=group_url,
            proxy=proxy
        )
        self.account_manager.add_account(account)
        return account

    def remove_account(self, debugger_address: str) -> bool:
        """
        Remove an account.

        Args:
            debugger_address: Address of account to remove.

        Returns:
            True if removed.
        """
        # Remove account logger if exists
        if debugger_address in self._on_account_log:
            del self._on_account_log[debugger_address]
        return self.account_manager.remove_account(debugger_address)

    def update_account(self, account: Account) -> bool:
        """
        Update an existing account.

        Args:
            account: Account with updated values.

        Returns:
            True if updated.
        """
        return self.account_manager.update_account(account)

    def update_account_url(self, debugger_address: str, group_url: str) -> bool:
        """
        Update account's group URL.

        Args:
            debugger_address: Account address.
            group_url: New group URL.

        Returns:
            True if updated.
        """
        account = self.account_manager.get_account(debugger_address)
        if account:
            account.group_url = group_url
            self.account_manager.save_accounts()
            return True
        return False

    def build_proxies(self) -> int:
        """
        Fetch and assign proxies to accounts.

        Returns:
            Number of proxies assigned.
        """
        self._handle_log("Building proxy pool...")
        self._handle_status_change("Building proxies")

        accounts = self.account_manager.get_all_accounts()
        needed = len([a for a in accounts if not a.proxy])

        if needed == 0:
            self._handle_log("All accounts have proxies")
            return 0

        return self.account_manager.assign_proxies()

    def start_run(self) -> bool:
        """
        Start the bot run.

        Returns:
            True if started successfully.
        """
        if self.is_running:
            self._handle_log("Already running!")
            return False

        accounts = self.account_manager.get_all_accounts()
        if not accounts:
            self._handle_log("No accounts loaded!")
            return False

        self.is_running = True
        self._handle_status_change("Running")

        # Run in background thread
        self._run_thread = self.orchestrator.run_async(
            accounts=accounts,
            account_loggers=self._on_account_log
        )

        return True

    def stop_run(self) -> None:
        """Stop the current run."""
        if self.is_running:
            self._handle_log("Stopping...")
            self.orchestrator.stop()
            self.is_running = False

    def shutdown(self) -> None:
        """Shutdown all services."""
        self.stop_run()
        self.orchestrator.shutdown()
        self._handle_log("Shutdown complete")

    def get_statistics(self) -> Dict[str, int]:
        """
        Get account statistics.

        Returns:
            Dictionary of status counts.
        """
        return self.account_manager.get_statistics()

    def get_total_invites(self) -> int:
        """
        Get total invites sent.

        Returns:
            Total invite count.
        """
        return self.account_manager.total_invites()

    def get_use_proxy(self) -> bool:
        """Get current proxy enabled state."""
        return settings.use_proxy

    def set_use_proxy(self, enabled: bool) -> None:
        """
        Set proxy enabled state.

        Args:
            enabled: Whether to enable proxy usage.
        """
        settings.use_proxy = enabled
        status = "enabled" if enabled else "disabled"
        self._handle_log(f"Proxy usage {status}")

    def get_batch_size(self) -> int:
        """Get current batch size."""
        return settings.batch_size

    def set_batch_size(self, size: int) -> None:
        """
        Set batch size.

        Args:
            size: Number of accounts per batch.
        """
        if 1 <= size <= 20:
            settings.batch_size = size
            self._handle_log(f"Batch size set to {size}")

    def get_max_clicks(self) -> int:
        """Get current max clicks per account."""
        return settings.max_clicks

    def set_max_clicks(self, clicks: int) -> None:
        """
        Set max clicks per account.

        Args:
            clicks: Maximum friend requests per account.
        """
        if 1 <= clicks <= 200:
            settings.max_clicks = clicks
            self._handle_log(f"Max clicks set to {clicks}")

    def get_scroll_delay(self) -> tuple:
        """Get current scroll delay range."""
        return (settings.scroll_pause_min, settings.scroll_pause_max)

    def set_scroll_delay(self, min_delay: float, max_delay: float) -> None:
        """
        Set scroll delay range.

        Args:
            min_delay: Minimum delay between scrolls.
            max_delay: Maximum delay between scrolls.
        """
        if 0.5 <= min_delay <= max_delay:
            settings.scroll_pause_min = min_delay
            settings.scroll_pause_max = max_delay
            self._handle_log(f"Scroll delay set to {min_delay}-{max_delay}s")

    def clear_all_proxies(self) -> None:
        """Clear proxies from all accounts."""
        for account in self.account_manager.get_all_accounts():
            account.clear_proxy()
        self._handle_log("Cleared proxies from all accounts")

    def get_proxy_manager(self) -> ProxyManager:
        """
        Get the proxy manager instance.

        Returns:
            ProxyManager instance.
        """
        return self.proxy_manager

    # ========== Task Configuration Methods ==========

    def get_action_types(self) -> List[tuple]:
        """
        Get available action types for UI display.

        Returns:
            List of (ActionType, label) tuples.
        """
        return [
            (ActionType.INVITE, "Invite Friends"),
            (ActionType.POST_WALL, "Post to Wall"),
            (ActionType.POST_GROUP, "Post to Group"),
            (ActionType.SHARE, "Share Post"),
            (ActionType.COMMENT, "Comment on Post"),
            (ActionType.UNFOLLOW, "Unfollow Users"),
        ]

    def get_current_action(self) -> ActionType:
        """Get current action type."""
        return self.current_action

    def set_current_action(self, action: ActionType) -> None:
        """Set current action type."""
        self.current_action = action
        self._handle_log(f"Action changed to: {action.value}")

    def set_task_target_url(self, url: str) -> None:
        """Set target URL for the task."""
        self.task_target_url = url

    def set_task_content(self, content: str) -> None:
        """Set content for the task."""
        self.task_content = content

    def get_task_config(self) -> TaskConfig:
        """
        Build TaskConfig from current settings.

        Returns:
            TaskConfig instance.
        """
        return TaskConfig(
            action_type=self.current_action,
            target_url=self.task_target_url or None,
            content=self.task_content or None,
            max_count=settings.max_clicks
        )

    def start_run_with_task(self, task_config: TaskConfig = None) -> bool:
        """
        Start a run with specific task configuration.

        Args:
            task_config: Task configuration (uses current settings if not provided).

        Returns:
            True if started successfully.
        """
        if self.is_running:
            self._handle_log("Already running!")
            return False

        accounts = self.account_manager.get_all_accounts()
        if not accounts:
            self._handle_log("No accounts loaded!")
            return False

        # Use provided config or build from current settings
        config = task_config or self.get_task_config()

        # Validate configuration
        if config.action_type == ActionType.INVITE:
            # For invite, use account.group_url or task_target_url
            pass
        elif config.action_type in [ActionType.POST_GROUP, ActionType.COMMENT]:
            if not config.target_url or not config.content:
                self._handle_log("Missing URL or content for this action!")
                return False
        elif config.action_type == ActionType.POST_WALL:
            if not config.content:
                self._handle_log("Missing content for post!")
                return False
        elif config.action_type in [ActionType.SHARE, ActionType.UNFOLLOW]:
            if not config.target_url:
                self._handle_log("Missing URL for this action!")
                return False

        self.is_running = True
        self._handle_status_change(f"Running: {config.action_label}")

        # Set task config on orchestrator
        self.orchestrator.set_task_config(config)

        # Run in background thread
        self._run_thread = self.orchestrator.run_async(
            accounts=accounts,
            account_loggers=self._on_account_log
        )

        return True

    def open_browser_for_account(self, account: Account) -> None:
        """
        Open Chrome browser for a specific account to check login.

        Args:
            account: The account to open browser for.
        """
        def _open():
            try:
                self._handle_log(f"Opening browser for {account.debugger_address}...")

                # Start Chrome (headless=False to see UI)
                success = self.browser_manager.start_chrome(
                    port=account.port,
                    proxy=account.proxy,
                    headless=False
                )

                if success:
                    # Get driver and navigate to Facebook
                    driver = self.browser_manager.get_driver(account.port)
                    if driver:
                        driver.get("https://facebook.com")
                        self._handle_log(f"Browser opened for {account.debugger_address}")
                    else:
                        self._handle_log(f"Failed to connect WebDriver for {account.debugger_address}")
                else:
                    self._handle_log(f"Failed to start Chrome for {account.debugger_address}")

            except Exception as e:
                self._handle_log(f"Error opening browser for {account.debugger_address}: {e}")

        # Run in a separate thread to not block UI
        threading.Thread(target=_open, daemon=True).start()

    def test_login_for_account(
        self,
        account: Account,
        on_result: Optional[Callable[[str, str], None]] = None
    ) -> None:
        """
        Test auto-login for an account by opening Chrome and performing login.

        Flow:
        1. Check if credentials exist
        2. Start Chrome (headless=False - user can see)
        3. Connect WebDriver
        4. Call perform_login() from FacebookAutomation
        5. Return result via callback

        Args:
            account: Account to test login for.
            on_result: Callback(status, message) called when done.
                       status: "success" | "2fa" | "wrong_pass" | "error" |
                               "no_credentials" | "chrome_failed"
        """
        from utils.crypto import decrypt_password, has_credentials
        from app.core.automation import FacebookAutomation
        import time

        def _run():
            self._handle_log(f"[TEST LOGIN] Starting for {account.display_name}...")

            # Step 1: Check credentials
            if not has_credentials(account):
                msg = "No credentials stored. Please set FB email/password first (right-click -> Set FB Credentials)."
                self._handle_log(f"[TEST LOGIN] {msg}")
                if on_result:
                    on_result("no_credentials", msg)
                return

            # Step 2: Start Chrome (visible - headless=False)
            self._handle_log(f"[TEST LOGIN] Starting Chrome on port {account.port}...")
            success = self.browser_manager.start_chrome(
                port=account.port,
                proxy=account.proxy,
                headless=False  # MUST be False: user needs to see the browser
            )

            if not success:
                msg = f"Failed to start Chrome on port {account.port}. Check if Chrome is installed."
                self._handle_log(f"[TEST LOGIN] {msg}")
                if on_result:
                    on_result("chrome_failed", msg)
                return

            # Step 3: Connect WebDriver
            time.sleep(1.5)  # Brief wait for Chrome to be ready
            driver = self.browser_manager.get_driver(account.port)

            if not driver:
                msg = f"Failed to connect WebDriver to Chrome on port {account.port}."
                self._handle_log(f"[TEST LOGIN] {msg}")
                if on_result:
                    on_result("chrome_failed", msg)
                return

            # Step 4: Decrypt credentials
            try:
                email = account.fb_email
                password = decrypt_password(account.fb_password_enc)
            except Exception as e:
                msg = f"Failed to decrypt credentials: {e}"
                self._handle_log(f"[TEST LOGIN] {msg}")
                if on_result:
                    on_result("error", msg)
                return

            # Step 5: Perform login via FacebookAutomation
            self._handle_log(f"[TEST LOGIN] Navigating to Facebook login page...")
            automation = FacebookAutomation(
                driver=driver,
                logger=self.logger,
                on_log=lambda msg: self._handle_log(f"[TEST LOGIN] {msg}")
            )

            login_result = automation.perform_login(email, password)

            # Step 6: Map result to user-friendly message
            result_messages = {
                "success": (
                    "success",
                    f"Login SUCCESSFUL for {account.display_name}!\n\n"
                    f"The account is now logged in. Chrome will remain open so you can verify."
                ),
                "2fa": (
                    "2fa",
                    f"2FA / Checkpoint Required for {account.display_name}.\n\n"
                    f"Facebook is asking for additional verification.\n"
                    f"Please complete it manually in the Chrome window."
                ),
                "wrong_pass": (
                    "wrong_pass",
                    f"Login FAILED for {account.display_name}.\n\n"
                    f"Incorrect email or password. Please update credentials\n"
                    f"(right-click -> Set FB Credentials)."
                ),
                "timeout": (
                    "timeout",
                    f"Login TIMEOUT for {account.display_name}.\n\n"
                    f"Could not determine login result. Check the Chrome window manually."
                ),
                "error": (
                    "error",
                    f"Login ERROR for {account.display_name}.\n\n"
                    f"An unexpected error occurred. Check Chrome window and logs."
                ),
            }

            status, message = result_messages.get(
                login_result,
                ("error", f"Unknown result: {login_result}")
            )

            self._handle_log(f"[TEST LOGIN] Result: {login_result} -> {status}")

            if on_result:
                on_result(status, message)

        threading.Thread(target=_run, daemon=True).start()

    # ========== Auto Loop Methods ==========

    def start_auto_loop(self, task_config: TaskConfig = None) -> bool:
        """
        Start the auto-loop with configured intervals.

        Args:
            task_config: Task configuration (uses current settings if not provided).

        Returns:
            True if started successfully.
        """
        if self.is_running:
            self._handle_log("Already running!")
            return False

        if not settings.auto_loop_enabled:
            self._handle_log("Auto loop is disabled. Enable it in settings first.")
            return False

        accounts = self.account_manager.get_all_accounts()
        if not accounts:
            self._handle_log("No accounts loaded!")
            return False

        # Use provided config or build from current settings
        config = task_config or self.get_task_config()

        self.is_running = True
        self._handle_status_change(f"Auto Loop: {config.action_label}")

        # Set task config on orchestrator
        self.orchestrator.set_task_config(config)

        # Run auto loop in background thread
        def on_loop_complete(run_num, results):
            total_invites = sum(r.total_invites for r in results)
            self._handle_log(f"Loop #{run_num} complete: {total_invites} invites")

        self._run_thread = self.orchestrator.run_loop_async(
            accounts=accounts,
            account_loggers=self._on_account_log,
            on_loop_complete=on_loop_complete
        )

        self._handle_log(
            f"Auto loop started: every {settings.auto_loop_interval_minutes} minutes, "
            f"max {settings.auto_loop_max_runs if settings.auto_loop_max_runs > 0 else 'unlimited'} runs"
        )
        return True

    def get_auto_loop_enabled(self) -> bool:
        """Get auto loop enabled state."""
        return settings.auto_loop_enabled

    def set_auto_loop_enabled(self, enabled: bool) -> None:
        """Set auto loop enabled state."""
        settings.auto_loop_enabled = enabled
        status = "enabled" if enabled else "disabled"
        self._handle_log(f"Auto loop {status}")

    def get_auto_loop_interval(self) -> int:
        """Get auto loop interval in minutes."""
        return settings.auto_loop_interval_minutes

    def set_auto_loop_interval(self, minutes: int) -> None:
        """Set auto loop interval in minutes."""
        if 5 <= minutes <= 1440:
            settings.auto_loop_interval_minutes = minutes
            self._handle_log(f"Auto loop interval set to {minutes} minutes")

    def get_concurrent_browsers(self) -> int:
        """Get number of concurrent browsers."""
        return settings.concurrent_browsers

    def set_concurrent_browsers(self, count: int) -> None:
        """Set number of concurrent browsers."""
        if 1 <= count <= 10:
            settings.concurrent_browsers = count
            self._handle_log(f"Concurrent browsers set to {count}")

    # ========== Pause/Resume Methods ==========

    def pause_run(self) -> None:
        """Pause the current run."""
        if self.is_running:
            self.orchestrator.pause()
            self._handle_log("Bot paused")

    def resume_run(self) -> None:
        """Resume a paused run."""
        self.orchestrator.resume()
        self._handle_log("Bot resumed")

    def is_paused(self) -> bool:
        """Check if the bot is currently paused."""
        return self.orchestrator.is_paused

    # ========== Reset Status Methods ==========

    def reset_error_accounts(self) -> int:
        """
        Reset all ERROR status accounts to IDLE for retry.

        Returns:
            Number of accounts reset.
        """
        count = self.account_manager.reset_error_accounts()
        if count > 0:
            self._handle_log(f"Reset {count} ERROR accounts to IDLE")
        else:
            self._handle_log("No ERROR accounts to reset")
        return count

    def reset_checkpoint_accounts(self) -> int:
        """
        Reset all CHECKPOINT status accounts to IDLE for retry.

        Returns:
            Number of accounts reset.
        """
        count = self.account_manager.reset_checkpoint_accounts()
        if count > 0:
            self._handle_log(f"Reset {count} CHECKPOINT accounts to IDLE")
        else:
            self._handle_log("No CHECKPOINT accounts to reset")
        return count

    def reset_all_account_status(self) -> None:
        """Reset all accounts to IDLE status."""
        self.account_manager.reset_all_status()
        self.account_manager.save_accounts()
        self._handle_log("All account statuses reset to IDLE")

    # ========== Health Check Methods ==========

    def check_account_health(self, quick: bool = False) -> Dict:
        """
        Check health of all accounts.

        Args:
            quick: If True, only check port connectivity.

        Returns:
            Dictionary with health check results.
        """
        from app.services.health_checker import AccountHealthChecker

        self._handle_log("Starting health check...")
        self._handle_status_change("Health Check")

        checker = AccountHealthChecker(
            browser_manager=self.browser_manager,
            logger=self.logger
        )

        accounts = self.account_manager.get_all_accounts()
        results = checker.check_all(accounts, quick=quick)
        summary = checker.get_summary(results)

        self._handle_log(
            f"Health check complete: "
            f"{summary['healthy']}/{summary['total']} healthy, "
            f"{summary['chrome_not_running']} Chrome not running, "
            f"{summary['checkpoint']} checkpoint"
        )

        return {
            "results": results,
            "summary": summary
        }

    # ========== Report Methods ==========

    def generate_report(self, results: List[BatchResult]) -> str:
        """
        Generate a report for completed run.

        Args:
            results: List of BatchResult from the run.

        Returns:
            Path to the generated report.
        """
        from app.services.report_generator import report_generator

        report_path = report_generator.generate_run_report(results)
        self._handle_log(f"Report generated: {report_path}")
        return str(report_path)

    def get_recent_reports(self, limit: int = 10) -> List[str]:
        """
        Get list of recent report files.

        Args:
            limit: Maximum number of reports to return.

        Returns:
            List of report file paths.
        """
        from app.services.report_generator import report_generator

        reports = report_generator.get_recent_reports(limit)
        return [str(p) for p in reports]

    # ─────────────────────────────────────────────────────────────────────
    #  Feature Test Runner – runs any single automation feature on any Chrome
    # ─────────────────────────────────────────────────────────────────────

    def run_feature_test(
        self,
        address: str,
        func_id: str,
        params: dict,
        log_fn: callable,
        stop_event
    ) -> dict:
        """
        Execute a single automation function on any Chrome instance.

        This is the backend called by TestFeatureDialog.
        Connects to Chrome at `address`, executes the function identified
        by `func_id` with the given `params`, streams logs via `log_fn`,
        and respects `stop_event` for cancellation.

        Args:
            address: Chrome debugger address (host:port).
            func_id: ID of the function to run (matches TestFeatureDialog.FUNCTIONS ids).
            params: Dict of parameter values for the function.
            log_fn: Callable(message: str) — writes to the live log.
            stop_event: threading.Event — set to cancel the test.

        Returns:
            dict with keys: status ("success"|"error"|"info"), message, and extra data.
        """
        import socket
        import time
        from app.core.browser import BrowserManager
        from app.core.automation import FacebookAutomation

        log = log_fn  # alias

        # ── Parse address ──────────────────────────────────────────────
        try:
            host, port_str = address.rsplit(":", 1)
            port = int(port_str)
        except ValueError:
            return {"status": "error", "message": f"Invalid address: {address}"}

        # ──────────────────────────────────────────────────────────────
        #  fn: check_connection  – only check port, no Selenium needed
        # ──────────────────────────────────────────────────────────────
        if func_id == "check_connection":
            log(f"Checking port {host}:{port}…")
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(2)
                    result = s.connect_ex((host, port))
                if result == 0:
                    log(f"→ Port {port} is OPEN")
                    # Try Selenium connect
                    log("Connecting Selenium WebDriver…")
                    bm = BrowserManager(logger=self.logger)
                    driver = bm.get_driver(port)
                    if driver:
                        title = driver.title
                        url = driver.current_url
                        log(f"✓ Selenium connected! Page: {title}")
                        log(f"  URL: {url}")
                        bm.close_driver(port)
                        return {"status": "success",
                                "message": "Chrome connected via Selenium",
                                "page_title": title,
                                "current_url": url}
                    else:
                        return {"status": "error",
                                "message": "Port open but Selenium could not connect (check ChromeDriver)"}
                else:
                    return {"status": "error",
                            "message": f"Port {port} is CLOSED — Chrome not running or wrong port"}
            except Exception as e:
                return {"status": "error", "message": str(e)}

        # ──────────────────────────────────────────────────────────────
        #  All other functions need Selenium → connect first
        # ──────────────────────────────────────────────────────────────
        log(f"Connecting to Chrome at {address}…")
        bm = BrowserManager(logger=self.logger)
        driver = bm.get_driver(port)

        if not driver:
            return {"status": "error",
                    "message": f"Cannot connect to Chrome at {address}. Is the port open?"}

        log(f"✓ Connected to Chrome  •  page: {driver.title[:60]}")

        # Build automation wrapper
        def _make_auto() -> FacebookAutomation:
            return FacebookAutomation(driver=driver, logger=self.logger, on_log=log_fn)

        try:
            # ── check_login_status ──────────────────────────────────
            if func_id == "check_login_status":
                auto = _make_auto()
                log("Navigating to Facebook home…")
                driver.get("https://www.facebook.com/")
                time.sleep(3)
                if stop_event.is_set():
                    return {"status": "info", "message": "Stopped by user"}

                url = driver.current_url.lower()
                if auto.check_checkpoint():
                    return {"status": "info", "message": "Account is at CHECKPOINT",
                            "logged_in": False, "checkpoint": True}
                if auto.check_logged_out():
                    return {"status": "info", "message": "Account is LOGGED OUT",
                            "logged_in": False}
                if "facebook.com" in url and "login" not in url:
                    title = driver.title
                    return {"status": "success",
                            "message": "Account is LOGGED IN",
                            "logged_in": True,
                            "page_title": title}
                return {"status": "info", "message": f"Uncertain status  •  URL: {url}",
                        "current_url": url}

            # ── check_checkpoint ────────────────────────────────────
            elif func_id == "check_checkpoint":
                auto = _make_auto()
                log(f"Checking checkpoint on current page…")
                log(f"  URL: {driver.current_url}")
                is_cp = auto.check_checkpoint()
                is_out = auto.check_logged_out()
                msg = ("CHECKPOINT detected!" if is_cp
                       else "LOGGED OUT!" if is_out
                       else "No checkpoint — looks OK")
                return {"status": "info" if not is_cp else "error",
                        "message": msg,
                        "checkpoint": is_cp,
                        "logged_out": is_out,
                        "current_url": driver.current_url}

            # ── test_login ──────────────────────────────────────────
            elif func_id == "test_login":
                email = params.get("email", "")
                password = params.get("password", "")
                if not email or not password:
                    return {"status": "error", "message": "Email and password are required"}
                auto = _make_auto()
                log(f"Attempting login as: {email}")
                result_code = auto.perform_login(email, password)
                status_map = {
                    "success":    ("success", "Login successful!"),
                    "2fa":        ("info",    "2FA / Checkpoint required"),
                    "wrong_pass": ("error",   "Wrong email or password"),
                    "timeout":    ("error",   "Login timed out"),
                    "error":      ("error",   "Unknown error during login"),
                }
                st, msg = status_map.get(result_code, ("error", result_code))
                return {"status": st, "message": msg, "login_result": result_code}

            # ── navigate_url ────────────────────────────────────────
            elif func_id == "navigate_url":
                url = params.get("url", "https://www.facebook.com")
                log(f"Navigating to: {url}")
                driver.get(url)
                time.sleep(3)
                if stop_event.is_set():
                    return {"status": "info", "message": "Stopped"}
                final_url = driver.current_url
                title = driver.title
                log(f"✓ Loaded:  {title}")
                log(f"  URL: {final_url}")
                return {"status": "success", "message": f"Navigated to: {final_url}",
                        "page_title": title, "final_url": final_url}

            # ── scroll_page ─────────────────────────────────────────
            elif func_id == "scroll_page":
                count = int(params.get("count", 5))
                auto = _make_auto()
                log(f"Scrolling {count} times…")
                for i in range(count):
                    if stop_event.is_set():
                        log("Stopped.")
                        break
                    auto.scroll_page()
                    log(f"  Scroll {i+1}/{count} done")
                    time.sleep(1.2)
                return {"status": "success", "message": f"Scrolled {count} times",
                        "scrolls_done": count}

            # ── find_invite_buttons ─────────────────────────────────
            elif func_id == "find_invite_buttons":
                auto = _make_auto()
                log(f"Scanning page for Add Friend buttons…")
                log(f"  Current URL: {driver.current_url}")
                buttons = auto._find_add_friend_buttons()
                log(f"  Found {len(buttons)} unique visible Add Friend buttons")
                for i, btn in enumerate(buttons[:10]):
                    txt = auto._get_button_text(btn)
                    log(f"  [{i+1}] {txt}")
                return {"status": "success" if buttons else "info",
                        "message": f"Found {len(buttons)} Add Friend button(s)",
                        "button_count": len(buttons)}

            # ── navigate_group ──────────────────────────────────────
            elif func_id == "navigate_group":
                group_url = params.get("group_url", "")
                if not group_url:
                    return {"status": "error", "message": "Group URL is required"}
                auto = _make_auto()
                log(f"Navigating to group members page…")
                ok = auto.navigate_to_group(group_url)
                final_url = driver.current_url
                on_members = auto._is_on_members_page()
                return {"status": "success" if ok and on_members else "error",
                        "message": "On members page ✓" if on_members else "Navigation may have failed",
                        "on_members_page": on_members,
                        "final_url": final_url}

            # ── dry_run_invite ──────────────────────────────────────
            elif func_id == "dry_run_invite":
                group_url = params.get("group_url", "").strip()
                max_scrolls = int(params.get("max_scrolls", 5))
                auto = _make_auto()

                if group_url:
                    log(f"Navigating to: {group_url}")
                    auto.navigate_to_group(group_url)
                    if stop_event.is_set():
                        return {"status": "info", "message": "Stopped"}

                log(f"Dry-run scan (max {max_scrolls} scrolls)…")
                total_found = 0
                for i in range(max_scrolls):
                    if stop_event.is_set():
                        log("Stopped.")
                        break
                    buttons = auto._find_add_friend_buttons()
                    log(f"  Scroll {i+1}: {len(buttons)} Add Friend buttons visible")
                    total_found = max(total_found, len(buttons))
                    auto.scroll_page()
                    time.sleep(1.5)

                # Check status
                is_cp = auto.check_checkpoint()
                is_out = auto.check_logged_out()
                extra = ""
                if is_cp:
                    extra = "  ⚠️ CHECKPOINT detected!"
                elif is_out:
                    extra = "  ⚠️ Logged out!"
                log(f"Dry-run complete.{extra}")
                return {"status": "success",
                        "message": f"Dry run done. Max buttons seen: {total_found}{extra}",
                        "max_buttons_found": total_found,
                        "checkpoint": is_cp,
                        "logged_out": is_out}

            # ── invite_members ──────────────────────────────────────
            elif func_id == "invite_members":
                group_url = params.get("group_url", "").strip()
                max_clicks = int(params.get("max_clicks", 5))
                max_scrolls = int(params.get("max_scrolls", 10))
                auto = _make_auto()

                if group_url:
                    log(f"Navigating to: {group_url}")
                    ok = auto.navigate_to_group(group_url)
                    if not ok:
                        return {"status": "error", "message": "Navigation failed"}
                    if stop_event.is_set():
                        return {"status": "info", "message": "Stopped"}

                log(f"Starting invite (max {max_clicks} invites, {max_scrolls} scrolls)…")
                scrolls, invites = auto.scroll_and_invite(
                    max_scrolls=max_scrolls,
                    max_clicks=max_clicks
                )
                return {"status": "success" if invites > 0 else "info",
                        "message": f"Sent {invites} invite(s) in {scrolls} scrolls",
                        "invites_sent": invites,
                        "scrolls_done": scrolls}

            # ── post_wall ───────────────────────────────────────────
            elif func_id == "post_wall":
                content = params.get("content", "")
                if not content:
                    return {"status": "error", "message": "Content is required"}
                auto = _make_auto()
                log(f"Posting to wall: {content[:60]}…")
                ok = auto.post_to_wall(content)
                return {"status": "success" if ok else "error",
                        "message": "Posted to wall ✓" if ok else "Post failed"}

            # ── post_group ──────────────────────────────────────────
            elif func_id == "post_group":
                group_url = params.get("group_url", "")
                content = params.get("content", "")
                if not group_url or not content:
                    return {"status": "error", "message": "Group URL and content are required"}
                auto = _make_auto()
                log(f"Posting to group: {group_url}")
                ok = auto.post_to_group(group_url, content)
                return {"status": "success" if ok else "error",
                        "message": "Posted to group ✓" if ok else "Post failed"}

            # ── share_post ──────────────────────────────────────────
            elif func_id == "share_post":
                post_url = params.get("post_url", "")
                if not post_url:
                    return {"status": "error", "message": "Post URL is required"}
                auto = _make_auto()
                log(f"Sharing post: {post_url}")
                ok = auto.share_post(post_url)
                return {"status": "success" if ok else "error",
                        "message": "Shared ✓" if ok else "Share failed"}

            # ── comment_post ────────────────────────────────────────
            elif func_id == "comment_post":
                post_url = params.get("post_url", "")
                content = params.get("content", "")
                if not post_url or not content:
                    return {"status": "error", "message": "Post URL and comment text are required"}
                auto = _make_auto()
                log(f"Commenting on: {post_url}")
                ok = auto.comment_on_post(post_url, content)
                return {"status": "success" if ok else "error",
                        "message": "Commented ✓" if ok else "Comment failed"}

            # ── get_page_info ───────────────────────────────────────
            elif func_id == "get_page_info":
                log("Reading page info…")
                title = driver.title
                url = driver.current_url
                try:
                    dom_size = driver.execute_script(
                        "return document.querySelectorAll('*').length;")
                    link_count = driver.execute_script(
                        "return document.querySelectorAll('a').length;")
                    btn_count = driver.execute_script(
                        "return document.querySelectorAll('[role=button]').length;")
                except Exception:
                    dom_size = link_count = btn_count = "?"
                log(f"  Title:   {title}")
                log(f"  URL:     {url}")
                log(f"  DOM elements: {dom_size}")
                log(f"  Links:   {link_count}")
                log(f"  Buttons: {btn_count}")
                return {"status": "success", "message": "Page info retrieved",
                        "title": title, "url": url,
                        "dom_elements": dom_size,
                        "links": link_count,
                        "role_buttons": btn_count}

            # ── run_js ──────────────────────────────────────────────
            elif func_id == "run_js":
                script = params.get("script", "return document.title;")
                log(f"Executing JS: {script[:100]}")
                result_val = driver.execute_script(script)
                log(f"→ Return value: {result_val}")
                return {"status": "success", "message": "JS executed",
                        "return_value": str(result_val)}

            else:
                return {"status": "error", "message": f"Unknown function id: {func_id}"}

        except Exception as e:
            self.logger.error(f"Feature test error [{func_id}]: {e}", exc_info=True)
            log(f"Exception: {e}")
            return {"status": "error", "message": str(e)}

        finally:
            # Disconnect driver but don't stop Chrome itself
            try:
                bm.close_driver(port)
            except Exception:
                pass


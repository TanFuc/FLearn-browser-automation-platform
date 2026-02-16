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

    def _handle_log(self, message: str) -> None:
        """Handle log message from orchestrator."""
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

    def get_accounts(self) -> List[Account]:
        """
        Get all accounts.

        Returns:
            List of all accounts.
        """
        return self.account_manager.get_all_accounts()

    def add_account(
        self,
        debugger_address: str,
        group_url: Optional[str] = None
    ) -> Account:
        """
        Add a new account.

        Args:
            debugger_address: Chrome debugger address.
            group_url: Optional Facebook group URL.

        Returns:
            Created account.
        """
        account = Account(
            debugger_address=debugger_address,
            group_url=group_url
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
        return self.account_manager.remove_account(debugger_address)

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

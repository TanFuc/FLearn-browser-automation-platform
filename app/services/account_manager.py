"""
Account Manager Service.

Manages account state, file I/O, and proxy assignments.
"""

import json
import logging
from pathlib import Path
from typing import Callable, Dict, List, Optional

from app.config import settings
from app.core.proxy import ProxyManager
from app.models import Account, AccountStatus, Proxy


class AccountManager:
    """
    Manages Facebook accounts and their state.

    Handles loading/saving accounts from files, assigning proxies,
    and tracking account status.

    Attributes:
        accounts: Dictionary of accounts by debugger address.
        proxy_manager: ProxyManager instance for proxy operations.
        logger: Logger instance.
    """

    def __init__(
        self,
        proxy_manager: Optional[ProxyManager] = None,
        logger: Optional[logging.Logger] = None,
        on_log: Optional[Callable[[str], None]] = None
    ) -> None:
        """
        Initialize AccountManager.

        Args:
            proxy_manager: Optional ProxyManager instance.
            logger: Optional logger instance.
            on_log: Optional callback for log messages.
        """
        self.logger = logger or logging.getLogger(__name__)
        self.on_log = on_log
        self.proxy_manager = proxy_manager or ProxyManager(logger=self.logger)
        self.accounts: Dict[str, Account] = {}

    def _log(self, message: str, level: int = logging.INFO) -> None:
        """Log a message and optionally call the callback."""
        self.logger.log(level, message)
        if self.on_log:
            self.on_log(message)

    def load_accounts(self, file_path: Path = None) -> List[Account]:
        """
        Load accounts from JSON file.

        Args:
            file_path: Path to accounts JSON file.

        Returns:
            List of loaded accounts.
        """
        file_path = file_path or settings.account_status_file

        if not file_path.exists():
            self._log(f"Account file not found: {file_path}", logging.WARNING)
            return []

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            accounts = []
            for item in data:
                try:
                    account = Account.from_dict(item)
                    self.accounts[account.debugger_address] = account
                    accounts.append(account)
                except Exception as e:
                    self._log(f"Error parsing account: {e}", logging.WARNING)

            self._log(f"Loaded {len(accounts)} accounts from {file_path}")
            return accounts

        except Exception as e:
            self._log(f"Error loading accounts: {e}", logging.ERROR)
            return []

    def save_accounts(self, file_path: Path = None) -> bool:
        """
        Save accounts to JSON file.

        Args:
            file_path: Path to save accounts to.

        Returns:
            True if saved successfully, False otherwise.
        """
        file_path = file_path or settings.account_status_file

        try:
            data = [acc.to_dict() for acc in self.accounts.values()]

            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

            self._log(f"Saved {len(data)} accounts to {file_path}")
            return True

        except Exception as e:
            self._log(f"Error saving accounts: {e}", logging.ERROR)
            return False

    def add_account(self, account: Account, save: bool = True) -> None:
        """
        Add an account to the manager.

        Args:
            account: Account to add.
            save: Whether to save to disk immediately.
        """
        self.accounts[account.debugger_address] = account
        self._log(f"Added account: {account.debugger_address}")
        if save:
            self.save_accounts()

    def update_account(self, account: Account, save: bool = True) -> bool:
        """
        Update an existing account.

        Args:
            account: Account with updated values.
            save: Whether to save to disk immediately.

        Returns:
            True if updated, False if not found.
        """
        if account.debugger_address not in self.accounts:
            self._log(
                f"Account not found for update: {account.debugger_address}",
                logging.WARNING
            )
            return False

        self.accounts[account.debugger_address] = account
        self._log(f"Updated account: {account.debugger_address}")
        if save:
            self.save_accounts()
        return True

    def remove_account(self, debugger_address: str, save: bool = True) -> bool:
        """
        Remove an account from the manager.

        Args:
            debugger_address: Address of account to remove.
            save: Whether to save to disk immediately.

        Returns:
            True if removed, False if not found.
        """
        if debugger_address in self.accounts:
            del self.accounts[debugger_address]
            self._log(f"Removed account: {debugger_address}")
            if save:
                self.save_accounts()
            return True
        return False

    def get_account(self, debugger_address: str) -> Optional[Account]:
        """
        Get an account by debugger address.

        Args:
            debugger_address: Address to look up.

        Returns:
            Account if found, None otherwise.
        """
        return self.accounts.get(debugger_address)

    def get_all_accounts(self) -> List[Account]:
        """
        Get all accounts.

        Returns:
            List of all accounts.
        """
        return list(self.accounts.values())

    def get_accounts_by_status(self, status: AccountStatus) -> List[Account]:
        """
        Get accounts with a specific status.

        Args:
            status: Status to filter by.

        Returns:
            List of accounts with the specified status.
        """
        return [acc for acc in self.accounts.values() if acc.status == status]

    def assign_proxies(self, accounts: List[Account] = None) -> int:
        """
        Assign proxies to accounts that need them.

        Args:
            accounts: Accounts to assign proxies to (default: all without proxy).

        Returns:
            Number of proxies assigned.
        """
        # Skip if proxy is disabled globally
        if not settings.use_proxy:
            self._log("Proxy disabled globally, skipping assignment")
            return 0

        if accounts is None:
            accounts = [acc for acc in self.accounts.values() if acc.proxy is None]

        if not accounts:
            self._log("No accounts need proxies")
            return 0

        # Ensure we have enough proxies
        needed = len(accounts)
        self._log(f"Need {needed} proxies for accounts")

        proxies = self.proxy_manager.ensure_proxies(needed)
        if len(proxies) < needed:
            self._log(
                f"Warning: Only {len(proxies)} proxies available for {needed} accounts",
                logging.WARNING
            )

        assigned = 0
        for account in accounts:
            proxy = self.proxy_manager.get_proxy()
            if proxy:
                account.assign_proxy(proxy)
                assigned += 1
                self._log(f"Assigned {proxy.address} to {account.debugger_address}")

        self._log(f"Assigned {assigned} proxies to accounts")
        return assigned

    def refresh_proxy(self, account: Account) -> bool:
        """
        Assign a new proxy to an account.

        Args:
            account: Account needing a new proxy.

        Returns:
            True if new proxy assigned, False otherwise.
        """
        # Skip if proxy is disabled globally
        if not settings.use_proxy:
            self._log(f"Proxy disabled, clearing proxy for {account.debugger_address}")
            account.clear_proxy()
            return True

        if account.proxy:
            self.proxy_manager.mark_proxy_dead(account.proxy)

        new_proxy = self.proxy_manager.get_proxy()
        if new_proxy:
            account.assign_proxy(new_proxy)
            self._log(f"Refreshed proxy for {account.debugger_address}: {new_proxy.address}")
            return True

        self._log(f"No proxy available for {account.debugger_address}", logging.WARNING)
        return False

    def test_account_proxy(self, account: Account) -> bool:
        """
        Test if an account's proxy is still working.

        Args:
            account: Account to test.

        Returns:
            True if proxy works, False otherwise.
        """
        if not account.proxy:
            return True  # No proxy to test

        if self.proxy_manager.test_proxy(account.proxy):
            return True

        self._log(f"Proxy dead for {account.debugger_address}: {account.proxy.address}")
        account.set_proxy_dead()
        return False

    def create_default_accounts(
        self,
        ports: List[int],
        group_urls: Dict[int, str] = None
    ) -> List[Account]:
        """
        Create accounts with default configuration.

        Args:
            ports: List of debugging ports.
            group_urls: Optional mapping of port to group URL.

        Returns:
            List of created accounts.
        """
        accounts = []
        group_urls = group_urls or {}

        for port in ports:
            account = Account(
                debugger_address=f"127.0.0.1:{port}",
                group_url=group_urls.get(port)
            )
            self.accounts[account.debugger_address] = account
            accounts.append(account)

        self._log(f"Created {len(accounts)} default accounts")
        return accounts

    def reset_all_status(self) -> None:
        """Reset all accounts to IDLE status."""
        for account in self.accounts.values():
            account.status = AccountStatus.IDLE
            account.error_message = None

    def get_statistics(self) -> Dict[str, int]:
        """
        Get account statistics by status.

        Returns:
            Dictionary of status counts.
        """
        stats = {status.value: 0 for status in AccountStatus}
        for account in self.accounts.values():
            stats[account.status.value] += 1
        return stats

    def total_invites(self) -> int:
        """
        Get total invites sent across all accounts.

        Returns:
            Total invite count.
        """
        return sum(acc.invites_sent for acc in self.accounts.values())

"""
Account Health Checker Module.

Provides pre-run validation for account health including:
- Chrome port connectivity
- WebDriver connection
- Facebook login status
- Checkpoint detection
"""

import logging
import socket
from dataclasses import dataclass
from typing import Dict, List, Optional

from selenium.webdriver.remote.webdriver import WebDriver

from app.config import settings
from app.core.automation import FacebookAutomation
from app.core.browser import BrowserManager
from app.models import Account, AccountStatus


@dataclass
class HealthStatus:
    """Result of a health check for a single account."""
    ok: bool
    issue: Optional[str] = None
    chrome_running: bool = False
    webdriver_connected: bool = False
    facebook_logged_in: bool = False
    no_checkpoint: bool = False


class AccountHealthChecker:
    """
    Check account health before running bot.

    Validates Chrome connectivity, WebDriver attachment, Facebook login,
    and checkpoint status for each account.
    """

    def __init__(
        self,
        browser_manager: Optional[BrowserManager] = None,
        logger: Optional[logging.Logger] = None
    ) -> None:
        """
        Initialize AccountHealthChecker.

        Args:
            browser_manager: Optional BrowserManager instance.
            logger: Optional logger instance.
        """
        self.browser_manager = browser_manager or BrowserManager()
        self.logger = logger or logging.getLogger(__name__)

    def check_all(
        self,
        accounts: List[Account],
        quick: bool = False
    ) -> Dict[str, HealthStatus]:
        """
        Check health for all accounts.

        Args:
            accounts: List of accounts to check.
            quick: If True, only check port connectivity (faster).

        Returns:
            Dictionary mapping debugger_address to HealthStatus.
        """
        results = {}
        for account in accounts:
            self.logger.info(f"Checking health for {account.debugger_address}...")
            results[account.debugger_address] = self._check_account(account, quick)
        return results

    def _check_account(self, account: Account, quick: bool = False) -> HealthStatus:
        """
        Check health of a single account.

        Args:
            account: Account to check.
            quick: If True, only check port connectivity.

        Returns:
            HealthStatus for the account.
        """
        status = HealthStatus(ok=False)

        # 1. Check Chrome port is open
        if not self._is_port_open(account.port):
            status.issue = f"Chrome not running on port {account.port}"
            self.logger.warning(f"[{account.debugger_address}] {status.issue}")
            return status

        status.chrome_running = True

        # Quick check stops here
        if quick:
            status.ok = True
            return status

        # 2. Check WebDriver can connect
        driver = self._try_connect(account.port)
        if not driver:
            status.issue = "WebDriver connection failed"
            self.logger.warning(f"[{account.debugger_address}] {status.issue}")
            return status

        status.webdriver_connected = True

        try:
            # 3. Check if logged into Facebook
            if not self._is_logged_in(driver):
                status.issue = "Not logged into Facebook"
                self.logger.warning(f"[{account.debugger_address}] {status.issue}")
                return status

            status.facebook_logged_in = True

            # 4. Check for checkpoint
            automation = FacebookAutomation(driver, logger=self.logger)
            if automation.check_checkpoint():
                status.issue = "Checkpoint detected"
                self.logger.warning(f"[{account.debugger_address}] {status.issue}")
                account.status = AccountStatus.CHECKPOINT
                return status

            status.no_checkpoint = True
            status.ok = True
            self.logger.info(f"[{account.debugger_address}] Health check passed")

        except Exception as e:
            status.issue = f"Error during health check: {str(e)}"
            self.logger.error(f"[{account.debugger_address}] {status.issue}")

        return status

    def _is_port_open(self, port: int, host: str = "127.0.0.1") -> bool:
        """Check if a port is open and accepting connections."""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(2)
                result = sock.connect_ex((host, port))
                return result == 0
        except Exception:
            return False

    def _try_connect(self, port: int) -> Optional[WebDriver]:
        """Try to connect WebDriver to Chrome on port."""
        try:
            return self.browser_manager.get_driver(port)
        except Exception as e:
            self.logger.debug(f"WebDriver connection failed for port {port}: {e}")
            return None

    def _is_logged_in(self, driver: WebDriver) -> bool:
        """
        Check if the browser is logged into Facebook.

        Args:
            driver: WebDriver instance.

        Returns:
            True if logged in, False otherwise.
        """
        try:
            # Navigate to Facebook if not already there
            current_url = driver.current_url.lower()
            if "facebook.com" not in current_url:
                driver.get("https://www.facebook.com")

            # Check for login indicators
            login_indicators = [
                "facebook.com/login",
                "facebook.com/r.php",
                "facebook.com/?sk=lf",
            ]

            current_url = driver.current_url.lower()
            for indicator in login_indicators:
                if indicator in current_url:
                    return False

            # Check for logged-in elements (profile link, etc.)
            try:
                # Try to find the profile navigation element
                from selenium.webdriver.common.by import By
                from selenium.webdriver.support.ui import WebDriverWait
                from selenium.webdriver.support import expected_conditions as EC

                # Wait briefly for page to load
                WebDriverWait(driver, 5).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, "[aria-label='Facebook']"))
                )
                return True
            except Exception:
                # If we can't find the element but URL seems OK, assume logged in
                return "facebook.com/login" not in current_url

        except Exception as e:
            self.logger.debug(f"Error checking login status: {e}")
            return False

    def get_summary(self, results: Dict[str, HealthStatus]) -> Dict[str, int]:
        """
        Get summary statistics from health check results.

        Args:
            results: Health check results from check_all().

        Returns:
            Dictionary with counts for each status.
        """
        summary = {
            "total": len(results),
            "healthy": 0,
            "chrome_not_running": 0,
            "webdriver_failed": 0,
            "not_logged_in": 0,
            "checkpoint": 0,
            "other_errors": 0,
        }

        for status in results.values():
            if status.ok:
                summary["healthy"] += 1
            elif "Chrome not running" in (status.issue or ""):
                summary["chrome_not_running"] += 1
            elif "WebDriver" in (status.issue or ""):
                summary["webdriver_failed"] += 1
            elif "logged in" in (status.issue or ""):
                summary["not_logged_in"] += 1
            elif "Checkpoint" in (status.issue or ""):
                summary["checkpoint"] += 1
            else:
                summary["other_errors"] += 1

        return summary

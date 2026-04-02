"""
Browser Management Module.

Provides Chrome browser instance management with remote debugging support.
Encapsulates subprocess management, WebDriver connections, and cleanup.
Includes User-Agent rotation for anti-detection.
"""

import atexit
import logging
import os
import random
import shutil
import socket
import subprocess
import time
from pathlib import Path
from typing import Dict, List, Optional

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.remote.webdriver import WebDriver

from app.config import settings
from app.models import Account, Proxy


# User-Agent pool for rotation (Windows, Mac, Linux - Chrome versions)
USER_AGENTS = [
    # Windows Chrome
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    # Mac Chrome
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    # Linux Chrome
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    # Windows Edge (Chromium-based)
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
]


def get_random_user_agent() -> str:
    """Get a random User-Agent string from the pool."""
    return random.choice(USER_AGENTS)


class BrowserManager:
    """
    Manages Chrome browser instances with remote debugging.

    Handles Chrome process lifecycle, WebDriver connections, proxy configuration,
    and ensures proper cleanup of resources.

    Attributes:
        logger: Logger instance for this manager.
        processes: Dictionary of Chrome subprocess by port.
        drivers: Dictionary of WebDriver instances by port.
    """

    def __init__(self, logger: Optional[logging.Logger] = None) -> None:
        """
        Initialize BrowserManager.

        Args:
            logger: Optional logger instance.
        """
        self.logger = logger or logging.getLogger(__name__)
        self.processes: Dict[int, subprocess.Popen] = {}
        self.drivers: Dict[int, WebDriver] = {}
        self._shutting_down = False

        # Register cleanup on exit
        atexit.register(self.shutdown_all)

    def _get_profile_path(self, port: int) -> Path:
        """Get Chrome profile directory for a port."""
        return settings.get_profile_path(port)

    def _is_port_open(self, port: int, host: str = "127.0.0.1") -> bool:
        """
        Check if a port is open and accepting connections.

        Args:
            port: Port number to check.
            host: Host to check.

        Returns:
            True if port is open, False otherwise.
        """
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(1)
                result = sock.connect_ex((host, port))
                return result == 0
        except Exception:
            return False

    def _wait_for_debugger(
        self,
        port: int,
        timeout: int = 30,
        check_interval: float = 0.5
    ) -> bool:
        """
        Wait for Chrome debugger to be ready on port.

        Args:
            port: Debugging port to wait for.
            timeout: Maximum wait time in seconds.
            check_interval: Time between checks in seconds.

        Returns:
            True if debugger is ready, False if timeout.
        """
        start_time = time.time()
        while time.time() - start_time < timeout:
            if self._is_port_open(port):
                self.logger.debug(f"Debugger ready on port {port}")
                return True
            time.sleep(check_interval)
        return False

    def _kill_zombie_on_port(self, port: int) -> None:
        """Kills any process (like a zombie Chrome) listening on the target port."""
        if os.name != 'nt':
            return  # Windows only for now
        try:
            # Find PID listening on the port
            cmd = f'netstat -ano | findstr LISTENING | findstr :{port}'
            output = subprocess.check_output(cmd, shell=True).decode()
            if output:
                lines = output.strip().split('\n')
                for line in lines:
                    parts = line.strip().split()
                    if len(parts) >= 5:
                        pid = parts[-1]
                        if pid.isdigit() and int(pid) > 0:
                            self.logger.warning(f"Found zombie process {pid} on port {port}. Killing it...")
                            subprocess.run(f'taskkill /F /PID {pid}', shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

    def start_chrome(
        self,
        port: int,
        proxy: Optional[Proxy] = None,
        headless: bool = None,
        user_agent: str = None
    ) -> bool:
        """
        Start a Chrome instance with remote debugging.

        Args:
            port: Debugging port for this instance.
            proxy: Optional proxy to use.
            headless: Run Chrome in headless mode (defaults to settings).
            user_agent: Custom User-Agent (defaults to random if rotation enabled).

        Returns:
            True if Chrome started successfully, False otherwise.
        """
        if port in self.processes:
            self.logger.warning(f"Chrome already running on port {port}")
            return True

        # Ensure no zombie process is holding the port
        self._kill_zombie_on_port(port)

        profile_path = self._get_profile_path(port)
        profile_path.mkdir(parents=True, exist_ok=True)

        # Determine headless mode
        if headless is None:
            headless = settings.headless

        # Get Chrome binary path (auto-detect if not specified)
        chrome_binary = settings.get_chrome_binary_path()
        if not chrome_binary or not chrome_binary.exists():
            self.logger.error("Chrome binary not found! Please set CHROME_BINARY_PATH in .env or settings.")
            return False

        # Build Chrome command
        cmd = [
            str(chrome_binary),
            f"--remote-debugging-port={port}",
            f"--user-data-dir={profile_path}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
            "--disable-popup-blocking",
            "--hide-crash-restore-bubble",
            "--disable-session-crashed-bubble",
        ]

        # User-Agent rotation
        if settings.user_agent_rotate:
            ua = user_agent or get_random_user_agent()
            cmd.append(f'--user-agent={ua}')
            self.logger.debug(f"Using User-Agent: {ua[:50]}...")

        # Only add proxy if globally enabled AND proxy is provided
        if settings.use_proxy and proxy:
            cmd.append(f"--proxy-server={proxy.address}")
            self.logger.debug(f"Using proxy {proxy.address} for port {port}")

        # Disable images for faster loading
        if settings.disable_images:
            cmd.append("--blink-settings=imagesEnabled=false")
            self.logger.debug("Images disabled for faster loading")

        # Window size
        if settings.window_size:
            cmd.append(f"--window-size={settings.window_size}")

        if headless:
            cmd.extend(["--headless", "--disable-gpu"])

        try:
            self.logger.info(f"Starting Chrome on port {port}...")
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
            )
            self.processes[port] = process

            # Wait for debugger to be ready
            if self._wait_for_debugger(port):
                self.logger.info(f"Chrome started on port {port}")
                return True
            else:
                self.logger.error(f"Chrome debugger not responding on port {port}")
                self.stop_chrome(port)
                return False

        except Exception as e:
            self.logger.error(f"Failed to start Chrome on port {port}: {e}")
            return False

    def stop_chrome(self, port: int, timeout: int = 5) -> bool:
        """
        Stop a Chrome instance gracefully.

        Args:
            port: Port of the Chrome instance to stop.
            timeout: Seconds to wait for graceful shutdown.

        Returns:
            True if stopped successfully, False otherwise.
        """
        # Close WebDriver first
        if port in self.drivers:
            try:
                self.drivers[port].quit()
            except Exception:
                pass
            finally:
                del self.drivers[port]

        # Stop Chrome process
        if port in self.processes:
            process = self.processes[port]
            try:
                process.terminate()
                try:
                    process.wait(timeout=timeout)
                except subprocess.TimeoutExpired:
                    self.logger.warning(f"Chrome {port} not responding, killing...")
                    process.kill()
                    process.wait(timeout=2)
                return True
            except Exception as e:
                self.logger.error(f"Error stopping Chrome {port}: {e}")
                return False
            finally:
                del self.processes[port]

        return True

    def get_driver(self, port: int) -> Optional[WebDriver]:
        """
        Get or create a WebDriver connected to Chrome on the specified port.

        Args:
            port: Debugging port to connect to.

        Returns:
            WebDriver instance or None if connection failed.
        """
        if self._shutting_down:
            return None

        if port in self.drivers:
            return self.drivers[port]

        if not self._is_port_open(port):
            self.logger.error(f"No Chrome debugger on port {port}")
            return None

        try:
            options = Options()
            options.add_experimental_option(
                "debuggerAddress",
                f"127.0.0.1:{port}"
            )

            service = None
            if settings.chromedriver_path and Path(settings.chromedriver_path).exists():
                service = Service(str(settings.chromedriver_path))
            else:
                # Let Selenium Manager handle driver
                service = Service()
            
            driver = webdriver.Chrome(service=service, options=options)
            self.drivers[port] = driver

            # Avoid closing windows on attach because some Chrome sessions expose
            # transient handles and closing them can invalidate the active target.
            try:
                handles = driver.window_handles
                if handles:
                    driver.switch_to.window(handles[0])
            except Exception as e:
                self.logger.debug(f"Error checking window handles on port {port}: {e}")

            try:
                driver.maximize_window()
            except Exception:
                pass

            self.logger.debug(f"WebDriver connected to port {port}")
            return driver

        except Exception as e:
            self.logger.error(f"Failed to connect WebDriver to port {port}: {e}")
            return None

    def close_driver(self, port: int) -> None:
        """
        Close WebDriver connection without stopping Chrome.

        Args:
            port: Port of the WebDriver to close.
        """
        if port in self.drivers:
            try:
                self.drivers[port].quit()
            except Exception:
                pass
            finally:
                del self.drivers[port]

    def start_accounts(self, accounts: List[Account], headless: bool = False) -> int:
        """
        Start Chrome instances for multiple accounts.

        Args:
            accounts: List of accounts to start Chrome for.
            headless: Run Chrome in headless mode.

        Returns:
            Number of successfully started instances.
        """
        started = 0
        for account in accounts:
            port = account.port
            proxy = account.proxy

            if self.start_chrome(port, proxy, headless):
                started += 1
            else:
                account.set_error("Failed to start Chrome")

        self.logger.info(f"Started {started}/{len(accounts)} Chrome instances")
        return started

    def stop_accounts(self, accounts: List[Account]) -> None:
        """
        Stop Chrome instances for multiple accounts.

        Args:
            accounts: List of accounts to stop Chrome for.
        """
        for account in accounts:
            self.stop_chrome(account.port)

    def shutdown_all(self) -> None:
        """Stop all Chrome instances and cleanup."""
        self._shutting_down = True
        self.logger.info("Shutting down all Chrome instances...")

        # Close all WebDriver connections
        for port in list(self.drivers.keys()):
            try:
                self.drivers[port].quit()
            except Exception:
                pass
        self.drivers.clear()

        # Stop all Chrome processes
        for port, process in list(self.processes.items()):
            try:
                process.terminate()
                process.wait(timeout=3)
            except Exception:
                try:
                    process.kill()
                except Exception:
                    pass
        self.processes.clear()

        self.logger.info("All Chrome instances stopped")

    def delete_profile(self, port: int) -> bool:
        """
        Delete Chrome profile directory for a port.

        Args:
            port: Port whose profile to delete.

        Returns:
            True if deleted successfully, False otherwise.
        """
        profile_path = self._get_profile_path(port)
        if profile_path.exists():
            try:
                shutil.rmtree(profile_path)
                self.logger.info(f"Deleted profile: {profile_path}")
                return True
            except Exception as e:
                self.logger.error(f"Failed to delete profile {profile_path}: {e}")
                return False
        return True

    def restart_with_proxy(
        self,
        port: int,
        new_proxy: Proxy,
        delete_profile: bool = False
    ) -> bool:
        """
        Restart Chrome instance with a new proxy.

        Args:
            port: Port of the Chrome instance.
            new_proxy: New proxy to use.
            delete_profile: Whether to delete profile before restart.

        Returns:
            True if restarted successfully, False otherwise.
        """
        self.stop_chrome(port)

        if delete_profile:
            self.delete_profile(port)

        return self.start_chrome(port, new_proxy)

    @property
    def active_ports(self) -> List[int]:
        """Get list of ports with active Chrome instances."""
        return list(self.processes.keys())

    @property
    def active_count(self) -> int:
        """Get count of active Chrome instances."""
        return len(self.processes)

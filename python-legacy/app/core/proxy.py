"""
Proxy Management Module.

Provides centralized proxy fetching, testing, and rotation functionality.
Consolidates all proxy-related logic from the legacy codebase.
"""

import logging
import threading
import time
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Callable, List, Optional, Set

import requests

from app.config import settings
from app.models import Proxy, ProxyProtocol


class ProxyProvider(ABC):
    """Abstract base class for proxy providers."""

    @abstractmethod
    def fetch(self) -> List[str]:
        """
        Fetch proxy list from the provider.

        Returns:
            List of proxy strings in 'ip:port' format.
        """
        pass

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name for logging."""
        pass


class ProxyScrapeProvider(ProxyProvider):
    """Proxy provider using ProxyScrape API."""

    def __init__(self, country: str = "vn") -> None:
        """
        Initialize ProxyScrape provider.

        Args:
            country: Country code for proxy filtering.
        """
        self.country = country
        self._name = f"ProxyScrape-{country.upper()}"

    @property
    def name(self) -> str:
        return self._name

    def fetch(self) -> List[str]:
        """Fetch proxies from ProxyScrape API."""
        try:
            url = (
                f"https://api.proxyscrape.com/v2/"
                f"?request=displayproxies&protocol=http"
                f"&timeout=10000&country={self.country}&ssl=all&anonymity=all"
            )
            response = requests.get(url, timeout=15)
            if response.status_code == 200:
                return [line.strip() for line in response.text.strip().split("\n") if line.strip()]
        except Exception:
            pass
        return []


class ProxyListDownloadProvider(ProxyProvider):
    """Proxy provider using proxy-list.download API."""

    @property
    def name(self) -> str:
        return "ProxyListDownload"

    def fetch(self) -> List[str]:
        """Fetch proxies from proxy-list.download."""
        try:
            url = "https://www.proxy-list.download/api/v1/get?type=http"
            response = requests.get(url, timeout=15)
            if response.status_code == 200:
                return [line.strip() for line in response.text.strip().split("\n") if line.strip()]
        except Exception:
            pass
        return []


class GitHubProxyProvider(ProxyProvider):
    """Proxy provider fetching from GitHub repositories."""

    SOURCES = [
        ("TheSpeedX", "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt"),
        ("ShiftyTR", "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt"),
        ("clarketm", "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt"),
    ]

    def __init__(self, source_name: str, url: str) -> None:
        """
        Initialize GitHub proxy provider.

        Args:
            source_name: Name of the source.
            url: URL to fetch proxies from.
        """
        self._name = f"GitHub-{source_name}"
        self.url = url

    @property
    def name(self) -> str:
        return self._name

    def fetch(self) -> List[str]:
        """Fetch proxies from GitHub raw file."""
        try:
            response = requests.get(self.url, timeout=15)
            if response.status_code == 200:
                return [line.strip() for line in response.text.strip().split("\n") if line.strip()]
        except Exception:
            pass
        return []


class ProxyManager:
    """
    Manages proxy pool with fetching, testing, and rotation.

    Consolidates all proxy operations including:
    - Multi-source proxy fetching
    - Concurrent proxy validation
    - Proxy caching and persistence
    - Proxy rotation for accounts

    Attributes:
        alive_proxies: List of currently working proxies.
        logger: Logger instance for this manager.
    """

    def __init__(
        self,
        logger: Optional[logging.Logger] = None,
        on_log: Optional[Callable[[str], None]] = None
    ) -> None:
        """
        Initialize ProxyManager.

        Args:
            logger: Optional logger instance.
            on_log: Optional callback for log messages.
        """
        self.logger = logger or logging.getLogger(__name__)
        self.on_log = on_log

        self.alive_proxies: List[Proxy] = []
        self._tested_proxies: Set[str] = set()
        self._lock = threading.Lock()
        self._stop_flag = threading.Event()

        # Initialize providers
        self._providers: List[ProxyProvider] = [
            ProxyScrapeProvider("vn"),
            ProxyScrapeProvider("us"),
            ProxyListDownloadProvider(),
        ]
        for name, url in GitHubProxyProvider.SOURCES:
            self._providers.append(GitHubProxyProvider(name, url))

    def _log(self, message: str, level: int = logging.INFO) -> None:
        """Log a message and optionally call the callback."""
        self.logger.log(level, message)
        if self.on_log:
            self.on_log(message)

    def _is_valid_port(self, port: int) -> bool:
        """Check if port is in the valid ports list."""
        return port in settings.proxy_valid_ports

    def _parse_proxy(self, proxy_str: str) -> Optional[Proxy]:
        """
        Parse proxy string to Proxy object.

        Args:
            proxy_str: Proxy string in 'ip:port' format.

        Returns:
            Proxy object or None if invalid.
        """
        try:
            proxy = Proxy.from_string(proxy_str)
            if self._is_valid_port(proxy.port):
                return proxy
        except ValueError:
            pass
        return None

    def test_proxy(self, proxy: Proxy, timeout: int = None) -> bool:
        """
        Test if a proxy works for Facebook access.

        Args:
            proxy: Proxy to test.
            timeout: Request timeout in seconds.

        Returns:
            True if proxy works, False otherwise.
        """
        if self._stop_flag.is_set():
            return False

        timeout = timeout or settings.proxy_test_timeout
        proxy_dict = {"http": proxy.url, "https": proxy.url}

        try:
            # Test IP retrieval
            start_time = time.time()
            ip_response = requests.get(
                "https://api.ipify.org",
                proxies=proxy_dict,
                timeout=timeout
            )
            if ip_response.status_code != 200:
                proxy.mark_dead()
                return False

            # Test Facebook access
            fb_response = requests.get(
                "https://www.facebook.com",
                proxies=proxy_dict,
                timeout=timeout
            )
            if fb_response.status_code == 200 and "facebook" in fb_response.text.lower():
                response_time = time.time() - start_time
                proxy.mark_alive(response_time)
                return True

        except Exception:
            pass

        proxy.mark_dead()
        return False

    def fetch_all_proxies(self) -> List[str]:
        """
        Fetch proxies from all providers.

        Returns:
            List of unique proxy strings.
        """
        all_proxies: Set[str] = set()

        for provider in self._providers:
            try:
                self._log(f"Fetching from {provider.name}...")
                proxies = provider.fetch()
                all_proxies.update(proxies)
                self._log(f"  Got {len(proxies)} from {provider.name}")
            except Exception as e:
                self._log(f"  Error from {provider.name}: {e}", logging.WARNING)

        # Filter by valid ports
        filtered = []
        for proxy_str in all_proxies:
            proxy = self._parse_proxy(proxy_str)
            if proxy:
                filtered.append(proxy.address)

        self._log(f"Total unique proxies after filtering: {len(filtered)}")
        return filtered

    def load_cached_proxies(self) -> List[Proxy]:
        """
        Load proxies from cache file.

        Returns:
            List of cached proxies.
        """
        proxies = []
        cache_file = Path(settings.proxy_best_file)

        if cache_file.exists():
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            proxy = self._parse_proxy(line)
                            if proxy:
                                proxies.append(proxy)
                self._log(f"Loaded {len(proxies)} cached proxies")
            except Exception as e:
                self._log(f"Error loading cache: {e}", logging.WARNING)

        return proxies

    def save_proxies(self) -> None:
        """Save current alive proxies to cache files."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        with self._lock:
            alive = [p for p in self.alive_proxies if p.is_alive]

        # Save to best file
        try:
            with open(settings.proxy_best_file, "w", encoding="utf-8") as f:
                for proxy in alive[:10]:  # Top 10 best
                    f.write(f"{proxy.address} | {timestamp}\n")
        except Exception as e:
            self._log(f"Error saving best proxies: {e}", logging.ERROR)

        # Save to alive file (no timestamp)
        try:
            with open(settings.proxy_alive_file, "w", encoding="utf-8") as f:
                for proxy in alive:
                    f.write(f"{proxy.address}\n")
        except Exception as e:
            self._log(f"Error saving alive proxies: {e}", logging.ERROR)

    def _add_working_proxy(self, proxy: Proxy) -> None:
        """Thread-safe addition of working proxy."""
        with self._lock:
            if proxy.address not in self._tested_proxies:
                self.alive_proxies.append(proxy)
                self._tested_proxies.add(proxy.address)

    def get_working_proxies(
        self,
        needed: int = None,
        max_threads: int = None,
        max_runtime: int = None
    ) -> List[Proxy]:
        """
        Test proxies concurrently and return working ones.

        Args:
            needed: Minimum number of proxies needed.
            max_threads: Maximum concurrent threads.
            max_runtime: Maximum runtime in seconds.

        Returns:
            List of working proxies.
        """
        needed = needed or settings.proxy_needed_count
        max_threads = max_threads or settings.proxy_max_threads
        max_runtime = max_runtime or settings.proxy_max_runtime

        self._stop_flag.clear()
        start_time = time.time()

        # First, test cached proxies
        cached = self.load_cached_proxies()
        for proxy in cached:
            if len(self.alive_proxies) >= needed:
                break
            if self.test_proxy(proxy):
                self._add_working_proxy(proxy)
                self._log(f"✓ Cached proxy working: {proxy.address}")

        if len(self.alive_proxies) >= needed:
            self._log(f"Got {len(self.alive_proxies)} proxies from cache")
            self.save_proxies()
            return self.alive_proxies

        # Fetch fresh proxies
        self._log("Fetching fresh proxies...")
        fresh_proxies = self.fetch_all_proxies()

        # Filter out already tested
        to_test = []
        for proxy_str in fresh_proxies:
            if proxy_str not in self._tested_proxies:
                proxy = self._parse_proxy(proxy_str)
                if proxy:
                    to_test.append(proxy)

        self._log(f"Testing {len(to_test)} fresh proxies...")

        # Concurrent testing
        with ThreadPoolExecutor(max_workers=max_threads) as executor:
            futures = {
                executor.submit(self.test_proxy, proxy): proxy
                for proxy in to_test
            }

            for future in as_completed(futures):
                # Check stop conditions
                if self._stop_flag.is_set():
                    break
                if time.time() - start_time > max_runtime:
                    self._log("Max runtime reached, stopping...")
                    self._stop_flag.set()
                    break
                if len(self.alive_proxies) >= needed:
                    self._log(f"Got enough proxies ({len(self.alive_proxies)})")
                    self._stop_flag.set()
                    break

                proxy = futures[future]
                try:
                    if future.result():
                        self._add_working_proxy(proxy)
                        self._log(f"✓ Proxy working: {proxy.address}")
                except Exception:
                    pass

        self.save_proxies()
        self._log(f"Final count: {len(self.alive_proxies)} working proxies")
        return self.alive_proxies

    def ensure_proxies(self, needed: int = None) -> List[Proxy]:
        """
        Ensure minimum number of proxies are available.

        Args:
            needed: Minimum proxies required.

        Returns:
            List of available proxies.
        """
        needed = needed or settings.proxy_needed_count

        if len(self.alive_proxies) >= needed:
            return self.alive_proxies

        return self.get_working_proxies(needed=needed)

    def get_proxy(self) -> Optional[Proxy]:
        """
        Get a single working proxy from the pool.

        Returns:
            A working proxy or None if pool is empty.
        """
        with self._lock:
            if self.alive_proxies:
                return self.alive_proxies.pop(0)
        return None

    def return_proxy(self, proxy: Proxy) -> None:
        """
        Return a proxy to the pool.

        Args:
            proxy: Proxy to return.
        """
        if proxy.is_alive:
            with self._lock:
                self.alive_proxies.append(proxy)

    def mark_proxy_dead(self, proxy: Proxy) -> None:
        """
        Mark a proxy as dead and log to bad file.

        Args:
            proxy: Dead proxy.
        """
        proxy.mark_dead()
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        try:
            with open(settings.proxy_bad_file, "a", encoding="utf-8") as f:
                f.write(f"{proxy.address} | {timestamp}\n")
        except Exception:
            pass

    def stop(self) -> None:
        """Signal to stop ongoing proxy operations."""
        self._stop_flag.set()

    def clear(self) -> None:
        """Clear all proxies and reset state."""
        with self._lock:
            self.alive_proxies.clear()
            self._tested_proxies.clear()
        self._stop_flag.clear()

    def get_proxy_with_fallback(self) -> Optional[Proxy]:
        """
        Get a proxy with fallback strategy.

        If no proxy available and fallback is enabled, returns None
        (indicating direct connection should be used).
        If no proxy and fallback disabled, tries to fetch more proxies.

        Returns:
            Proxy object or None (for direct connection).
        """
        proxy = self.get_proxy()

        if proxy:
            return proxy

        # No proxy available
        if settings.proxy_fallback_to_direct:
            self._log("No proxy available, falling back to direct connection")
            return None

        # Try to fetch more proxies
        self._log("No proxy available, fetching more...")
        self.ensure_proxies(needed=settings.proxy_needed_count)
        return self.get_proxy()

    def test_proxy_with_retry(
        self,
        proxy: Proxy,
        retry_count: int = None
    ) -> bool:
        """
        Test proxy with retry attempts.

        Args:
            proxy: Proxy to test.
            retry_count: Number of retry attempts.

        Returns:
            True if proxy works after retries.
        """
        retry_count = retry_count or settings.proxy_retry_count

        for attempt in range(retry_count):
            if self.test_proxy(proxy):
                return True
            if attempt < retry_count - 1:
                self._log(f"Proxy test failed, retrying ({attempt + 2}/{retry_count})...")
                time.sleep(1)

        return False

    def handle_proxy_failure(self, proxy: Proxy) -> Optional[Proxy]:
        """
        Handle a failed proxy by testing it again or getting a replacement.

        Uses the fallback strategy setting to determine behavior:
        - If retry succeeds, return same proxy
        - If retry fails and fallback enabled, return None (direct)
        - If retry fails and fallback disabled, get new proxy

        Args:
            proxy: The failed proxy.

        Returns:
            Same proxy if recovered, new proxy, or None for direct.
        """
        self._log(f"Handling failed proxy: {proxy.address}")

        # Try to recover the proxy
        if self.test_proxy_with_retry(proxy):
            self._log(f"Proxy recovered: {proxy.address}")
            return proxy

        # Mark as dead
        self.mark_proxy_dead(proxy)

        # Get replacement or fallback
        return self.get_proxy_with_fallback()

    def should_use_proxy(self) -> bool:
        """
        Check if proxy should be used based on settings and availability.

        Returns:
            True if proxy should be used.
        """
        if not settings.use_proxy:
            return False

        if not self.alive_proxies and not settings.proxy_fallback_to_direct:
            # Must have proxies if fallback is disabled
            self.ensure_proxies()

        return settings.use_proxy

    def get_status(self) -> dict:
        """
        Get current proxy pool status.

        Returns:
            Dictionary with proxy pool statistics.
        """
        with self._lock:
            alive_count = len(self.alive_proxies)
            tested_count = len(self._tested_proxies)

        return {
            "alive_count": alive_count,
            "tested_count": tested_count,
            "use_proxy": settings.use_proxy,
            "fallback_enabled": settings.proxy_fallback_to_direct
        }

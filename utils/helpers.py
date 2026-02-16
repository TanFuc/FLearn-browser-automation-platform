"""
General Helper Utilities.

Contains utility functions for timing, text processing, and other common operations.
"""

import random
import re
import time
from datetime import datetime
from typing import Optional, Tuple
from urllib.parse import urlparse


def random_delay(
    min_seconds: float = 1.0,
    max_seconds: float = 3.0
) -> float:
    """
    Sleep for a random duration and return the actual sleep time.

    Args:
        min_seconds: Minimum sleep time.
        max_seconds: Maximum sleep time.

    Returns:
        Actual sleep duration.
    """
    delay = random.uniform(min_seconds, max_seconds)
    time.sleep(delay)
    return delay


def random_range(min_val: int, max_val: int) -> int:
    """
    Get a random integer in range [min_val, max_val].

    Args:
        min_val: Minimum value.
        max_val: Maximum value.

    Returns:
        Random integer in range.
    """
    return random.randint(min_val, max_val)


def sanitize_url(url: str) -> Optional[str]:
    """
    Validate and sanitize a URL.

    Args:
        url: URL to sanitize.

    Returns:
        Sanitized URL or None if invalid.
    """
    if not url:
        return None

    url = url.strip()

    # Add scheme if missing
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    try:
        parsed = urlparse(url)
        if parsed.netloc:
            return url
    except Exception:
        pass

    return None


def is_facebook_url(url: str) -> bool:
    """
    Check if a URL is a valid Facebook URL.

    Args:
        url: URL to check.

    Returns:
        True if Facebook URL, False otherwise.
    """
    if not url:
        return False

    try:
        parsed = urlparse(url)
        return "facebook.com" in parsed.netloc.lower()
    except Exception:
        return False


def extract_group_id(url: str) -> Optional[str]:
    """
    Extract Facebook group ID from a URL.

    Args:
        url: Facebook group URL.

    Returns:
        Group ID or None if not found.
    """
    if not url:
        return None

    patterns = [
        r"/groups/(\d+)",
        r"/groups/([^/\?]+)",
    ]

    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)

    return None


def format_duration(seconds: float) -> str:
    """
    Format duration in seconds to human-readable string.

    Args:
        seconds: Duration in seconds.

    Returns:
        Formatted string like "2m 30s" or "1h 5m".
    """
    if seconds < 60:
        return f"{seconds:.1f}s"

    minutes = int(seconds // 60)
    remaining_seconds = int(seconds % 60)

    if minutes < 60:
        return f"{minutes}m {remaining_seconds}s"

    hours = minutes // 60
    remaining_minutes = minutes % 60
    return f"{hours}h {remaining_minutes}m"


def format_timestamp(dt: datetime = None, fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
    """
    Format a datetime to string.

    Args:
        dt: Datetime to format (default: now).
        fmt: Format string.

    Returns:
        Formatted timestamp string.
    """
    if dt is None:
        dt = datetime.now()
    return dt.strftime(fmt)


def parse_proxy_string(proxy_str: str) -> Optional[Tuple[str, int]]:
    """
    Parse proxy string to (ip, port) tuple.

    Args:
        proxy_str: Proxy string in 'ip:port' format.

    Returns:
        Tuple of (ip, port) or None if invalid.
    """
    if not proxy_str:
        return None

    # Handle timestamp format: "ip:port | timestamp"
    if "|" in proxy_str:
        proxy_str = proxy_str.split("|")[0].strip()

    parts = proxy_str.strip().split(":")
    if len(parts) != 2:
        return None

    ip, port_str = parts
    try:
        port = int(port_str)
        if 1 <= port <= 65535:
            return (ip, port)
    except ValueError:
        pass

    return None


def truncate_string(s: str, max_length: int = 50, suffix: str = "...") -> str:
    """
    Truncate a string to maximum length with suffix.

    Args:
        s: String to truncate.
        max_length: Maximum length.
        suffix: Suffix to add when truncated.

    Returns:
        Truncated string.
    """
    if len(s) <= max_length:
        return s
    return s[:max_length - len(suffix)] + suffix


def safe_int(value: str, default: int = 0) -> int:
    """
    Safely convert string to integer.

    Args:
        value: String to convert.
        default: Default value if conversion fails.

    Returns:
        Integer value or default.
    """
    try:
        return int(value)
    except (ValueError, TypeError):
        return default


def safe_float(value: str, default: float = 0.0) -> float:
    """
    Safely convert string to float.

    Args:
        value: String to convert.
        default: Default value if conversion fails.

    Returns:
        Float value or default.
    """
    try:
        return float(value)
    except (ValueError, TypeError):
        return default

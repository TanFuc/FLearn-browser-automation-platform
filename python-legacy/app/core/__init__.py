"""
Core Module Package.

Contains the core logic for browser management, proxy handling,
and Facebook automation.
"""

from app.core.browser import BrowserManager
from app.core.proxy import ProxyManager
from app.core.automation import FacebookAutomation

__all__ = ["BrowserManager", "ProxyManager", "FacebookAutomation"]

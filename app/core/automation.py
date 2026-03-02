"""
Facebook Automation Module.

Contains core automation logic for Facebook interactions including
scrolling, clicking, popup handling, and smart filtering.
"""

import logging
import random
import re
import time
from functools import wraps
from typing import Callable, List, Optional, Tuple, TypeVar

from selenium.common.exceptions import (
    ElementClickInterceptedException,
    NoSuchElementException,
    StaleElementReferenceException,
    TimeoutException,
    WebDriverException,
)
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.remote.webelement import WebElement
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from selenium.webdriver.common.keys import Keys

from app.config import settings
from app.models import Account, ActionType, TaskConfig, TaskResult

T = TypeVar("T")


def retry_on_stale(max_retries: int = 3, delay: float = 0.5) -> Callable:
    """
    Decorator to retry function on StaleElementReferenceException.

    Args:
        max_retries: Maximum number of retry attempts.
        delay: Delay between retries in seconds.

    Returns:
        Decorated function.
    """
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        def wrapper(*args, **kwargs) -> T:
            last_error = None
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except StaleElementReferenceException as e:
                    last_error = e
                    if attempt < max_retries - 1:
                        time.sleep(delay)
            raise last_error
        return wrapper
    return decorator


def with_error_handling(func: Callable[..., T]) -> Callable[..., Optional[T]]:
    """
    Decorator for safe element interaction with error handling.

    Args:
        func: Function to wrap.

    Returns:
        Wrapped function that returns None on error.
    """
    @wraps(func)
    def wrapper(*args, **kwargs) -> Optional[T]:
        try:
            return func(*args, **kwargs)
        except (NoSuchElementException, StaleElementReferenceException,
                TimeoutException, ElementClickInterceptedException):
            return None
        except WebDriverException:
            return None
    return wrapper


class FacebookAutomation:
    """
    Handles Facebook-specific automation tasks.

    Provides methods for navigating Facebook, scrolling through member lists,
    clicking add friend buttons, handling popups, and smart filtering.

    Attributes:
        driver: WebDriver instance for automation.
        logger: Logger instance.
        invites_sent: Count of successful friend invites.
        skipped_count: Count of skipped members (filtered).
    """

    # Button text patterns to look for (SPECIFIC patterns only - no generic "Add" or "Thêm")
    ADD_FRIEND_PATTERNS = [
        "Add friend", "Add Friend", "Thêm bạn bè", "Thêm bạn",
        "Kết bạn", "Add as friend", "Thêm làm bạn"
    ]

    # Members page URL patterns
    MEMBERS_PAGE_PATTERNS = [
        "/members",
        "/people",
        "?filter=members",
    ]

    POPUP_CONFIRM_PATTERNS = [
        "OK", "Đồng ý", "Tiếp tục", "Xác nhận",
        "Continue", "Confirm", "Done", "Xong"
    ]

    # Checkpoint URL patterns - these indicate actual checkpoint pages
    CHECKPOINT_URL_PATTERNS = [
        "/checkpoint/",
        "/login/checkpoint",
        "/security/checkpoint",
        "/recover/initiate",
        "/checkpoint?",
    ]

    # Login/Logged-out URL patterns - indicates session expired
    LOGIN_URL_PATTERNS = [
        "facebook.com/login",
        "facebook.com/r.php",
        "facebook.com/?sk=lf",
        "/login.php",
        "/login/?",
    ]

    # Login success indicators - URL patterns after successful login
    LOGIN_SUCCESS_INDICATORS = [
        "facebook.com/",
        "facebook.com/home",
        "facebook.com/?",
    ]

    # Login failure text patterns (page body text)
    LOGIN_FAILURE_INDICATORS = [
        "incorrect password",
        "wrong password",
        "password you entered is incorrect",
        "account not found",
        "email you entered isn't connected",
        "please re-enter your password",
        # Vietnamese
        "mật khẩu không đúng",
        "sai mật khẩu",
        "tài khoản không tồn tại",
        "email bạn nhập không kết nối",
        "vui lòng nhập lại mật khẩu",
    ]

    # Two-factor authentication indicators
    TWO_FA_INDICATORS = [
        "two-factor",
        "two factor",
        "2fa",
        "enter the code",
        "authentication code",
        "security code",
        "code generator",
        "login code",
        "approve from another device",
        # Vietnamese
        "xác minh hai yếu tố",
        "nhập mã",
        "mã xác thực",
        "mã bảo mật",
        "mã đăng nhập",
        "phê duyệt từ thiết bị khác",
    ]

    # Checkpoint page title/heading patterns - more specific than body text
    CHECKPOINT_TITLE_PATTERNS = [
        "confirm your identity",
        "xác minh danh tính",
        "we need to verify",
        "chúng tôi cần xác minh",
        "suspicious activity",
        "hoạt động đáng ngờ",
        "account has been locked",
        "tài khoản đã bị khóa",
        "security check",
        "kiểm tra bảo mật",
    ]

    # Admin/Moderator badge patterns
    ADMIN_PATTERNS = [
        "Admin", "Quản trị viên", "Moderator", "Người kiểm duyệt",
        "Group expert", "Chuyên gia nhóm"
    ]

    # Verified badge patterns
    VERIFIED_PATTERNS = [
        "Verified", "Đã xác minh", "✓"
    ]

    def __init__(
        self,
        driver: WebDriver,
        logger: Optional[logging.Logger] = None,
        on_log: Optional[Callable[[str], None]] = None
    ) -> None:
        """
        Initialize FacebookAutomation.

        Args:
            driver: Selenium WebDriver instance.
            logger: Optional logger instance.
            on_log: Optional callback for log messages.
        """
        self.driver = driver
        self.logger = logger or logging.getLogger(__name__)
        self.on_log = on_log
        self.invites_sent = 0
        self.skipped_count = 0

    def _log(self, message: str, level: int = logging.INFO) -> None:
        """Log a message and optionally call the callback."""
        self.logger.log(level, message)
        if self.on_log:
            self.on_log(message)

    def _random_delay(self, min_sec: float = None, max_sec: float = None) -> None:
        """
        Sleep for a random duration to simulate human behavior.

        Args:
            min_sec: Minimum sleep time.
            max_sec: Maximum sleep time.
        """
        min_sec = min_sec or settings.click_delay_min
        max_sec = max_sec or settings.click_delay_max
        time.sleep(random.uniform(min_sec, max_sec))

    def _is_admin_or_moderator(self, element_context: WebElement) -> bool:
        """
        Check if a member element has admin/moderator badge.

        Args:
            element_context: Parent element containing member info.

        Returns:
            True if admin/moderator badge found.
        """
        if not settings.skip_admins:
            return False

        try:
            context_text = element_context.text.lower()
            for pattern in self.ADMIN_PATTERNS:
                if pattern.lower() in context_text:
                    return True
        except Exception:
            pass
        return False

    def _is_verified(self, element_context: WebElement) -> bool:
        """
        Check if a member has a verified badge.

        Args:
            element_context: Parent element containing member info.

        Returns:
            True if verified badge found.
        """
        if not settings.skip_verified:
            return False

        try:
            context_text = element_context.text
            for pattern in self.VERIFIED_PATTERNS:
                if pattern in context_text:
                    return True
        except Exception:
            pass
        return False

    def _contains_blacklisted_keywords(self, element_context: WebElement) -> bool:
        """
        Check if member profile contains blacklisted keywords.

        Args:
            element_context: Parent element containing member info.

        Returns:
            True if blacklisted keywords found.
        """
        if not settings.keywords_blacklist:
            return False

        try:
            context_text = element_context.text.lower()
            for keyword in settings.keywords_blacklist:
                if keyword.lower() in context_text:
                    return True
        except Exception:
            pass
        return False

    def _should_skip_member(self, button: WebElement) -> Tuple[bool, str]:
        """
        Determine if a member should be skipped based on filters.

        Args:
            button: The add friend button element.

        Returns:
            Tuple of (should_skip, reason).
        """
        try:
            # Try to get the parent container with member info
            parent = button.find_element(By.XPATH, "./ancestor::div[contains(@class, 'x1yztbdb')]")
        except Exception:
            # If no parent found, don't skip
            return False, ""

        # Check admin/moderator
        if self._is_admin_or_moderator(parent):
            return True, "admin/mod"

        # Check verified
        if self._is_verified(parent):
            return True, "verified"

        # Check blacklisted keywords
        if self._contains_blacklisted_keywords(parent):
            return True, "blacklisted keyword"

        return False, ""

    def navigate_to_group(self, group_url: str) -> bool:
        """
        Navigate to a Facebook group URL.

        Args:
            group_url: URL of the Facebook group.

        Returns:
            True if navigation successful, False otherwise.
        """
        try:
            self.driver.get(group_url)
            time.sleep(3)  # Wait for page load
            self._log(f"Navigated to group: {group_url}")
            return True
        except Exception as e:
            self._log(f"Failed to navigate: {e}", logging.ERROR)
            return False

    def check_checkpoint(self) -> bool:
        """
        Check if account requires checkpoint verification.

        Uses multiple detection methods:
        1. URL-based detection (most reliable)
        2. Page title/heading detection
        3. Checkpoint-specific UI element detection

        Returns:
            True if checkpoint detected, False otherwise.
        """
        try:
            # Method 1: Check URL for checkpoint patterns (most reliable)
            current_url = self.driver.current_url.lower()
            for pattern in self.CHECKPOINT_URL_PATTERNS:
                if pattern in current_url:
                    self._log(f"Checkpoint detected (URL): {current_url}", logging.WARNING)
                    return True

            # Method 2: Check page title
            try:
                page_title = self.driver.title.lower()
                for pattern in self.CHECKPOINT_TITLE_PATTERNS:
                    if pattern in page_title:
                        self._log(f"Checkpoint detected (title): {page_title}", logging.WARNING)
                        return True
            except Exception:
                pass

            # Method 3: Look for specific checkpoint UI elements
            try:
                # Look for checkpoint-specific containers
                checkpoint_selectors = [
                    '[data-testid="checkpoint"]',
                    '[id*="checkpoint"]',
                    'form[action*="checkpoint"]',
                    '[class*="checkpoint"]',
                    '[data-pagelet="FxAccountRecoveryRootView"]',
                ]
                for selector in checkpoint_selectors:
                    elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                    if elements:
                        self._log(f"Checkpoint detected (element: {selector})", logging.WARNING)
                        return True
            except Exception:
                pass

            # Method 4: Check for specific heading text in H1/H2 elements only
            try:
                headings = self.driver.find_elements(By.CSS_SELECTOR, "h1, h2, [role='heading']")
                for heading in headings:
                    heading_text = heading.text.lower()
                    for pattern in self.CHECKPOINT_TITLE_PATTERNS:
                        if pattern in heading_text:
                            self._log(f"Checkpoint detected (heading): {heading_text[:50]}", logging.WARNING)
                            return True
            except Exception:
                pass

            return False

        except Exception as e:
            self.logger.debug(f"Error in checkpoint detection: {e}")
            return False

    def check_logged_out(self) -> bool:
        """
        Check if account has been logged out (session expired).

        Uses URL-based detection to identify login pages.

        Returns:
            True if logged out, False if still logged in.
        """
        try:
            current_url = self.driver.current_url.lower()

            # Check for login URL patterns
            for pattern in self.LOGIN_URL_PATTERNS:
                if pattern in current_url:
                    self._log(
                        f"[WARNING] Session expired - redirected to login page: {current_url}",
                        logging.WARNING
                    )
                    return True

            # Additional check: Look for login form elements
            try:
                login_form = self.driver.find_elements(By.CSS_SELECTOR, 'form[action*="login"]')
                email_field = self.driver.find_elements(By.CSS_SELECTOR, 'input[name="email"]')
                pass_field = self.driver.find_elements(By.CSS_SELECTOR, 'input[name="pass"]')

                if login_form or (email_field and pass_field):
                    # Double-check we're on a login page
                    if "facebook.com" in current_url and "home" not in current_url:
                        self._log(
                            f"[WARNING] Login form detected - session may have expired",
                            logging.WARNING
                        )
                        return True
            except Exception:
                pass

            return False

        except Exception as e:
            self.logger.debug(f"Error checking logged out status: {e}")
            return False

    def perform_login(self, email: str, password: str, timeout: int = 30) -> str:
        """
        Perform Facebook login with email and password.

        Args:
            email: Facebook email or phone number.
            password: Plaintext Facebook password.
            timeout: Maximum seconds to wait for login result.

        Returns:
            "success"    - Login successful
            "2fa"        - Two-factor authentication required
            "wrong_pass" - Wrong email/password
            "timeout"    - Timeout, result uncertain
            "error"      - Unknown error occurred
        """
        self._log("Attempting auto-login to Facebook...")

        try:
            # Step 1: Navigate to login page
            self.driver.get("https://www.facebook.com/login")
            time.sleep(random.uniform(2.0, 3.5))

            # Step 2: Find and fill email field
            email_field = self._wait_for_element(
                '//input[@id="email" or @name="email"]',
                timeout=10,
                clickable=True
            )
            if not email_field:
                self._log("Email field not found on login page", logging.WARNING)
                return "error"

            email_field.clear()
            self._type_with_delay(email_field, email)
            time.sleep(random.uniform(0.5, 1.2))

            # Step 3: Find and fill password field
            pass_field = self._wait_for_element(
                '//input[@id="pass" or @name="pass"]',
                timeout=5,
                clickable=True
            )
            if not pass_field:
                self._log("Password field not found", logging.WARNING)
                return "error"

            pass_field.clear()
            self._type_with_delay(pass_field, password)
            time.sleep(random.uniform(0.8, 1.5))

            # Step 4: Click login button
            login_btn = self._wait_for_element(
                '//button[@name="login" or @data-testid="royal_login_button" or @id="loginbutton"]'
                ' | //input[@value="Log In" or @value="Đăng nhập"]',
                timeout=5
            )
            if not login_btn:
                self._log("Login button not found", logging.WARNING)
                return "error"

            login_btn.click()
            self._log("Clicked login button, waiting for result...")

            # Step 5: Wait and check result
            time.sleep(random.uniform(3.0, 5.0))

            current_url = self.driver.current_url.lower()
            page_text = ""
            try:
                page_text = self.driver.find_element(By.TAG_NAME, "body").text.lower()
            except Exception:
                pass

            # Check for 2FA requirement
            for indicator in self.TWO_FA_INDICATORS:
                if indicator.lower() in page_text or indicator.lower() in current_url:
                    self._log("2FA/Checkpoint required after login", logging.WARNING)
                    return "2fa"

            # Check for wrong password
            for indicator in self.LOGIN_FAILURE_INDICATORS:
                if indicator.lower() in page_text:
                    self._log("Login failed: wrong credentials", logging.ERROR)
                    return "wrong_pass"

            # Check if still on login page (login failed)
            if "facebook.com/login" in current_url or "/login.php" in current_url:
                self._log("Still on login page after submit", logging.WARNING)
                return "wrong_pass"

            # Check for checkpoint
            if self.check_checkpoint():
                self._log("Checkpoint detected after login", logging.WARNING)
                return "2fa"

            # Check success: redirected away from login page
            if "facebook.com" in current_url and "login" not in current_url:
                self._log("Login successful!")
                return "success"

            self._log("Unknown login result state", logging.WARNING)
            return "timeout"

        except Exception as e:
            self._log(f"Exception during login: {e}", logging.ERROR)
            return "error"

    def _is_on_members_page(self) -> bool:
        """
        Check if the current page is a Facebook group members page.

        Returns:
            True if on members page, False otherwise.
        """
        try:
            current_url = self.driver.current_url.lower()
            for pattern in self.MEMBERS_PAGE_PATTERNS:
                if pattern in current_url:
                    return True
            return False
        except Exception:
            return False

    @retry_on_stale()
    def _find_add_friend_buttons(self) -> List[WebElement]:
        """
        Find all "Add Friend" buttons on the page.

        Returns:
            List of button elements.
        """
        buttons = []
        try:
            # Method 1: Find by exact aria-label (most reliable)
            for pattern in self.ADD_FRIEND_PATTERNS:
                xpath = f'//div[@aria-label="{pattern}" and @role="button"]'
                elements = self.driver.find_elements(By.XPATH, xpath)
                buttons.extend(elements)

            # Method 2: Find by text content with exact match (avoid partial matches)
            for pattern in self.ADD_FRIEND_PATTERNS:
                # Use exact text match, not contains
                xpath = f'//span[text()="{pattern}"]/ancestor::div[@role="button"]'
                elements = self.driver.find_elements(By.XPATH, xpath)
                buttons.extend(elements)

            # Method 3: Facebook-specific selector for member list add friend buttons
            # These are typically in the member cards with specific structure
            specific_xpath = (
                '//div[contains(@class, "x1yztbdb")]//div[@role="button"]'
                '[.//span[contains(text(), "Add") and contains(text(), "riend")] or '
                './/span[contains(text(), "Thêm") and contains(text(), "bạn")] or '
                './/span[contains(text(), "Kết bạn")]]'
            )
            elements = self.driver.find_elements(By.XPATH, specific_xpath)
            buttons.extend(elements)

        except Exception as e:
            self.logger.debug(f"Error finding buttons: {e}")

        # Remove duplicates and filter visible buttons only
        seen = set()
        unique_buttons = []
        for btn in buttons:
            try:
                btn_id = btn.id
                if btn_id not in seen:
                    # Only include buttons that are displayed
                    if btn.is_displayed():
                        seen.add(btn_id)
                        unique_buttons.append(btn)
            except Exception:
                pass

        return unique_buttons

    def _get_button_text(self, button: WebElement) -> str:
        """
        Get the text content of a button for logging.

        Args:
            button: Button element.

        Returns:
            Button text or empty string.
        """
        try:
            # Try to get aria-label first
            aria_label = button.get_attribute("aria-label")
            if aria_label:
                return aria_label

            # Try to get text content
            text = button.text.strip()
            if text:
                return text[:50]  # Limit length

            return "[unknown button]"
        except Exception:
            return "[error getting text]"

    @with_error_handling
    def _click_button(self, button: WebElement) -> bool:
        """
        Click a button element safely with verification.

        Args:
            button: Button element to click.

        Returns:
            True if click successful, False otherwise.
        """
        try:
            # Get button text for logging
            btn_text = self._get_button_text(button)

            # Verify it's likely an "Add Friend" button before clicking
            btn_text_lower = btn_text.lower()
            is_add_friend = any(
                pattern.lower() in btn_text_lower
                for pattern in ["add friend", "thêm bạn", "kết bạn", "add as friend"]
            )

            if not is_add_friend:
                self.logger.debug(f"Skipping non-Add-Friend button: {btn_text}")
                return False

            # Scroll button into view
            self.driver.execute_script(
                "arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});",
                button
            )
            time.sleep(0.3)

            # Check if button is still visible and enabled
            if not button.is_displayed():
                self.logger.debug(f"Button not displayed: {btn_text}")
                return False

            # Try regular click
            button.click()
            self.logger.debug(f"Clicked button: {btn_text}")
            return True

        except ElementClickInterceptedException:
            # Try JavaScript click
            try:
                self.driver.execute_script("arguments[0].click();", button)
                return True
            except Exception:
                return False

        except StaleElementReferenceException:
            self.logger.debug("Button became stale before click")
            return False

        except Exception as e:
            self.logger.debug(f"Click failed: {e}")
            return False

    def _handle_popup(self) -> bool:
        """
        Handle any confirmation popup that appears.

        Returns:
            True if popup handled, False otherwise.
        """
        try:
            time.sleep(0.5)  # Brief wait for popup

            for pattern in self.POPUP_CONFIRM_PATTERNS:
                xpath = f'//span[contains(text(), "{pattern}")]/ancestor::div[@role="button"]'
                buttons = self.driver.find_elements(By.XPATH, xpath)

                for button in buttons:
                    try:
                        if button.is_displayed():
                            button.click()
                            self.logger.debug(f"Clicked popup: {pattern}")
                            return True
                    except Exception:
                        continue

            return False

        except Exception:
            return False

    def scroll_page(self, pixels: int = None) -> None:
        """
        Scroll the page down by specified pixels.

        Args:
            pixels: Number of pixels to scroll.
        """
        if pixels is None:
            pixels = random.randint(600, 900)

        try:
            self.driver.execute_script(f"window.scrollBy(0, {pixels});")
        except Exception as e:
            self.logger.debug(f"Scroll error: {e}")

    def scroll_and_invite(
        self,
        max_scrolls: int = None,
        max_clicks: int = None,
        daily_remaining: int = None
    ) -> Tuple[int, int]:
        """
        Scroll through page and click add friend buttons.

        Args:
            max_scrolls: Maximum number of scroll iterations.
            max_clicks: Maximum number of friend requests.
            daily_remaining: Remaining invites for today (daily limit).

        Returns:
            Tuple of (scrolls_done, invites_sent).
        """
        # Use reasonable defaults - cap max_scrolls to prevent endless scrolling
        max_scrolls = min(max_scrolls or settings.max_scrolls, 100)
        max_clicks = max_clicks or settings.max_clicks

        # Apply daily limit if provided
        if daily_remaining is not None:
            if daily_remaining < max_clicks:
                self._log(f"Daily remaining ({daily_remaining}) is less than configured max invites ({max_clicks}). Using {daily_remaining}.")
            max_clicks = min(max_clicks, daily_remaining)

        # Dry run mode - only check connections, don't actually click
        if settings.dry_run:
            self._log("[DRY RUN] Mode enabled - checking page without clicking")
            buttons = self._find_add_friend_buttons()
            self._log(f"[DRY RUN] Found {len(buttons)} Add Friend buttons on current view")

            # Verify checkpoint and logged-out status
            if self.check_checkpoint():
                self._log("[DRY RUN] WARNING: Checkpoint detected!")
            if self.check_logged_out():
                self._log("[DRY RUN] WARNING: Session appears to be logged out!")

            self._log("[DRY RUN] Page check complete - no buttons clicked")
            return 1, 0  # Return 1 scroll, 0 invites

        scrolls_done = 0
        self.invites_sent = 0
        self.skipped_count = 0
        empty_scroll_count = 0  # Track consecutive scrolls with no buttons found
        max_empty_scrolls = 10  # Stop after this many consecutive empty scrolls

        self._log(f"Starting scroll & invite (max {max_clicks} invites, max {max_scrolls} scrolls)")

        for scroll_num in range(max_scrolls):
            if self.invites_sent >= max_clicks:
                self._log(f"Reached max invites: {self.invites_sent}")
                break

            # Find and click add friend buttons
            buttons = self._find_add_friend_buttons()

            if not buttons:
                empty_scroll_count += 1
                if empty_scroll_count >= max_empty_scrolls:
                    self._log(f"No Add Friend buttons found for {max_empty_scrolls} consecutive scrolls. Stopping.")
                    break
            else:
                empty_scroll_count = 0  # Reset counter when buttons found

            clicked_this_scroll = 0
            for button in buttons:
                if self.invites_sent >= max_clicks:
                    break

                # Smart filtering - check if should skip
                should_skip, skip_reason = self._should_skip_member(button)
                if should_skip:
                    self.skipped_count += 1
                    self.logger.debug(f"Skipped member: {skip_reason}")
                    continue

                if self._click_button(button):
                    self.invites_sent += 1
                    clicked_this_scroll += 1
                    self._log(f"✓ Invite #{self.invites_sent} sent")

                    # Handle any popup
                    self._handle_popup()

                    # Random delay between clicks
                    self._random_delay()

            # If we found buttons but couldn't click any, count as empty scroll
            if buttons and clicked_this_scroll == 0:
                empty_scroll_count += 1
                if empty_scroll_count >= max_empty_scrolls:
                    self._log(f"No clickable buttons for {max_empty_scrolls} consecutive scrolls. Stopping.")
                    break

            # Scroll down
            self.scroll_page()
            scrolls_done += 1

            # Random pause between scrolls
            pause = random.uniform(
                settings.scroll_pause_min,
                settings.scroll_pause_max
            )
            time.sleep(pause)

            # Log progress periodically
            if scroll_num % 5 == 0 and scroll_num > 0:
                self._log(f"Progress: Scrolls={scrolls_done}, Invites={self.invites_sent}, Skipped={self.skipped_count}, EmptyScrolls={empty_scroll_count}")

        self._log(f"Done! Scrolls: {scrolls_done}, Invites: {self.invites_sent}, Skipped: {self.skipped_count}")
        return scrolls_done, self.invites_sent

    def process_account(
        self,
        account: Account,
        daily_remaining: int = None
    ) -> TaskResult:
        """
        Process a single account - navigate and send invites.

        Args:
            account: Account to process.
            daily_remaining: Remaining invites for today (daily limit).

        Returns:
            TaskResult with outcome details.
        """
        start_time = time.time()
        result = TaskResult(account=account)

        try:
            account.set_running()

            # Navigate to group
            if not account.group_url:
                account.set_error("No group URL configured")
                result.error = "No group URL"
                return result

            if not self.navigate_to_group(account.group_url):
                account.set_error("Navigation failed")
                result.error = "Navigation failed"
                return result

            # Check for checkpoint
            if self.check_checkpoint():
                account.set_checkpoint()
                result.error = "Checkpoint"
                return result

            # Scroll and invite with daily limit
            scrolls, invites = self.scroll_and_invite(daily_remaining=daily_remaining)

            # Update result
            result.success = True
            result.invites_sent = invites
            result.duration = time.time() - start_time
            account.set_completed(invites)

            self._log(f"Account done: {invites} invites in {result.duration:.1f}s")

        except Exception as e:
            error_msg = str(e)
            self._log(f"Error processing account: {error_msg}", logging.ERROR)
            account.set_error(error_msg)
            result.error = error_msg
            result.duration = time.time() - start_time

        return result

    # ========== New Automation Methods ==========

    def _wait_for_element(
        self,
        xpath: str,
        timeout: int = 10,
        clickable: bool = True
    ) -> Optional[WebElement]:
        """
        Wait for an element to appear and be clickable.

        Args:
            xpath: XPath selector for the element.
            timeout: Maximum wait time in seconds.
            clickable: Whether to wait for element to be clickable.

        Returns:
            WebElement if found, None otherwise.
        """
        try:
            wait = WebDriverWait(self.driver, timeout)
            if clickable:
                element = wait.until(EC.element_to_be_clickable((By.XPATH, xpath)))
            else:
                element = wait.until(EC.presence_of_element_located((By.XPATH, xpath)))
            return element
        except (TimeoutException, NoSuchElementException):
            return None

    def _type_with_delay(self, element: WebElement, text: str) -> None:
        """
        Type text with human-like delays between keystrokes.

        Args:
            element: Element to type into.
            text: Text to type.
        """
        for char in text:
            element.send_keys(char)
            time.sleep(random.uniform(0.02, 0.08))

    def _navigate_to_url(self, url: str) -> bool:
        """
        Navigate to a URL and wait for page load.

        Args:
            url: URL to navigate to.

        Returns:
            True if successful, False otherwise.
        """
        try:
            self.driver.get(url)
            time.sleep(3)
            self._log(f"Navigated to: {url}")
            return True
        except Exception as e:
            self._log(f"Navigation failed: {e}", logging.ERROR)
            return False

    def post_to_wall(self, content: str) -> bool:
        """
        Create a new post on user's wall/profile.

        Args:
            content: Text content to post.

        Returns:
            True if posted successfully, False otherwise.
        """
        self._log("Starting post to wall...")

        try:
            # Navigate to Facebook home
            if not self._navigate_to_url("https://www.facebook.com/"):
                return False

            # Check for checkpoint
            if self.check_checkpoint():
                self._log("Checkpoint detected!", logging.WARNING)
                return False

            # Click on "What's on your mind?" input
            whats_on_mind_xpath = (
                "//span[contains(text(), \"What's on your mind\") or "
                "contains(text(), 'Bạn đang nghĩ gì')]"
            )
            trigger = self._wait_for_element(whats_on_mind_xpath, timeout=10)
            if not trigger:
                # Try alternative selector
                trigger = self._wait_for_element(
                    "//div[@role='button' and contains(@aria-label, 'Create a post') or "
                    "contains(@aria-label, 'Tạo bài viết')]",
                    timeout=5
                )

            if not trigger:
                self._log("Could not find post input trigger", logging.ERROR)
                return False

            trigger.click()
            self._random_delay(1, 2)

            # Find the post content text box
            post_box_xpath = (
                "//div[@role='textbox' and ("
                "contains(@aria-label, \"What's on your mind\") or "
                "contains(@aria-label, 'Bạn đang nghĩ gì') or "
                "contains(@aria-label, 'Create a public post') or "
                "contains(@aria-label, 'Tạo bài viết công khai'))]"
            )
            post_box = self._wait_for_element(post_box_xpath, timeout=10)
            if not post_box:
                self._log("Could not find post textbox", logging.ERROR)
                return False

            # Type content with human-like delays
            self._type_with_delay(post_box, content)
            self._random_delay(1, 2)

            # Click Post button
            post_btn_xpath = (
                "//div[@role='button' and ("
                "@aria-label='Post' or @aria-label='Đăng')]"
            )
            post_btn = self._wait_for_element(post_btn_xpath, timeout=10)
            if not post_btn:
                # Try alternative selector
                post_btn = self._wait_for_element(
                    "//span[text()='Post' or text()='Đăng']/ancestor::div[@role='button']",
                    timeout=5
                )

            if not post_btn:
                self._log("Could not find Post button", logging.ERROR)
                return False

            post_btn.click()
            self._random_delay(2, 4)

            self._log("Successfully posted to wall!")
            return True

        except Exception as e:
            self._log(f"Error posting to wall: {e}", logging.ERROR)
            return False

    def post_to_group(self, group_url: str, content: str) -> bool:
        """
        Create a new post in a Facebook group.

        Args:
            group_url: URL of the group.
            content: Text content to post.

        Returns:
            True if posted successfully, False otherwise.
        """
        self._log(f"Starting post to group: {group_url}")

        try:
            # Navigate to group
            if not self._navigate_to_url(group_url):
                return False

            # Check for checkpoint
            if self.check_checkpoint():
                self._log("Checkpoint detected!", logging.WARNING)
                return False

            # Click on "Write something..." input
            write_xpath = (
                "//span[contains(text(), 'Write something') or "
                "contains(text(), 'Bạn viết gì đi') or "
                "contains(text(), 'Viết gì đó')]"
            )
            trigger = self._wait_for_element(write_xpath, timeout=10)
            if not trigger:
                # Try alternative - look for the post creation area
                trigger = self._wait_for_element(
                    "//div[@role='button' and contains(@aria-label, 'Write something')]",
                    timeout=5
                )

            if not trigger:
                self._log("Could not find group post input trigger", logging.ERROR)
                return False

            trigger.click()
            self._random_delay(1, 2)

            # Find the post content text box
            post_box_xpath = (
                "//div[@role='textbox' and ("
                "contains(@aria-label, 'Write something') or "
                "contains(@aria-label, 'Bạn viết gì đi') or "
                "contains(@aria-label, 'Create a public post'))]"
            )
            post_box = self._wait_for_element(post_box_xpath, timeout=10)
            if not post_box:
                self._log("Could not find group post textbox", logging.ERROR)
                return False

            # Type content
            self._type_with_delay(post_box, content)
            self._random_delay(1, 2)

            # Click Post button
            post_btn_xpath = (
                "//div[@role='button' and ("
                "@aria-label='Post' or @aria-label='Đăng')]"
            )
            post_btn = self._wait_for_element(post_btn_xpath, timeout=10)
            if not post_btn:
                post_btn = self._wait_for_element(
                    "//span[text()='Post' or text()='Đăng']/ancestor::div[@role='button']",
                    timeout=5
                )

            if not post_btn:
                self._log("Could not find Post button", logging.ERROR)
                return False

            post_btn.click()
            self._random_delay(2, 4)

            self._log("Successfully posted to group!")
            return True

        except Exception as e:
            self._log(f"Error posting to group: {e}", logging.ERROR)
            return False

    def share_post(self, post_url: str) -> bool:
        """
        Share a Facebook post to user's timeline.

        Args:
            post_url: URL of the post to share.

        Returns:
            True if shared successfully, False otherwise.
        """
        self._log(f"Starting share post: {post_url}")

        try:
            # Navigate to post
            if not self._navigate_to_url(post_url):
                return False

            # Check for checkpoint
            if self.check_checkpoint():
                self._log("Checkpoint detected!", logging.WARNING)
                return False

            # Find Share button
            share_btn_xpath = (
                "//div[@role='button' and ("
                "@aria-label='Send this to friends or post it on your timeline.' or "
                "@aria-label='Share' or "
                "contains(@aria-label, 'Chia sẻ'))]"
            )
            share_btn = self._wait_for_element(share_btn_xpath, timeout=10)
            if not share_btn:
                # Try finding by text
                share_btn = self._wait_for_element(
                    "//span[text()='Share' or text()='Chia sẻ']/ancestor::div[@role='button']",
                    timeout=5
                )

            if not share_btn:
                self._log("Could not find Share button - post may not be shareable", logging.WARNING)
                return False

            share_btn.click()
            self._random_delay(1, 2)

            # Click "Share now (Public)" or "Share to Feed"
            share_now_xpath = (
                "//span[contains(text(), 'Share now') or "
                "contains(text(), 'Chia sẻ ngay') or "
                "contains(text(), 'Share to Feed') or "
                "contains(text(), 'Chia sẻ lên Bảng tin')]"
            )
            share_now = self._wait_for_element(share_now_xpath, timeout=5)
            if share_now:
                share_now.click()
                self._random_delay(2, 4)
                self._log("Successfully shared post!")
                return True

            # Alternative: Just click first option in menu
            menu_option_xpath = "//div[@role='menuitem']"
            menu_option = self._wait_for_element(menu_option_xpath, timeout=5)
            if menu_option:
                menu_option.click()
                self._random_delay(2, 4)
                self._log("Successfully shared post!")
                return True

            self._log("Could not find share option", logging.ERROR)
            return False

        except Exception as e:
            self._log(f"Error sharing post: {e}", logging.ERROR)
            return False

    def comment_on_post(self, post_url: str, content: str) -> bool:
        """
        Comment on a Facebook post.

        Args:
            post_url: URL of the post to comment on.
            content: Comment text content.

        Returns:
            True if commented successfully, False otherwise.
        """
        self._log(f"Starting comment on post: {post_url}")

        try:
            # Navigate to post
            if not self._navigate_to_url(post_url):
                return False

            # Check for checkpoint
            if self.check_checkpoint():
                self._log("Checkpoint detected!", logging.WARNING)
                return False

            # Find comment input box
            comment_box_xpath = (
                "//div[@role='textbox' and ("
                "contains(@aria-label, 'Write a comment') or "
                "contains(@aria-label, 'Viết bình luận') or "
                "contains(@aria-label, 'Write a public comment'))]"
            )
            comment_box = self._wait_for_element(comment_box_xpath, timeout=10)

            if not comment_box:
                # Try clicking "Comment" button first to reveal input
                comment_btn_xpath = (
                    "//div[@role='button' and ("
                    "@aria-label='Leave a comment' or "
                    "contains(@aria-label, 'Comment') or "
                    "contains(@aria-label, 'Bình luận'))]"
                )
                comment_btn = self._wait_for_element(comment_btn_xpath, timeout=5)
                if comment_btn:
                    comment_btn.click()
                    self._random_delay(0.5, 1)
                    comment_box = self._wait_for_element(comment_box_xpath, timeout=5)

            if not comment_box:
                self._log("Could not find comment input box", logging.ERROR)
                return False

            # Click to focus and type content
            comment_box.click()
            self._random_delay(0.5, 1)
            self._type_with_delay(comment_box, content)
            self._random_delay(0.5, 1)

            # Press Enter to submit or find submit button
            comment_box.send_keys(Keys.RETURN)
            self._random_delay(2, 3)

            self._log("Successfully commented on post!")
            return True

        except Exception as e:
            self._log(f"Error commenting on post: {e}", logging.ERROR)
            return False

    def unfollow_users(self, following_url: str, max_count: int = 50) -> int:
        """
        Unfollow users from the "Following" page.

        Args:
            following_url: URL of the following page (e.g., facebook.com/me/following).
            max_count: Maximum number of users to unfollow.

        Returns:
            Number of users unfollowed.
        """
        self._log(f"Starting unfollow from: {following_url}")
        unfollowed_count = 0

        try:
            # Navigate to following page
            if not self._navigate_to_url(following_url):
                return 0

            # Check for checkpoint
            if self.check_checkpoint():
                self._log("Checkpoint detected!", logging.WARNING)
                return 0

            for scroll_num in range(settings.max_scrolls):
                if unfollowed_count >= max_count:
                    self._log(f"Reached max unfollow count: {unfollowed_count}")
                    break

                # Find three-dot menu buttons on user cards
                menu_btn_xpath = (
                    "//div[@aria-label='Actions for this profile' or "
                    "@aria-label='More' or "
                    "contains(@aria-label, 'menu') or "
                    "contains(@aria-label, 'Tùy chọn')]//div[@role='button']"
                )

                # Alternative: Find "..." buttons in the following list
                alt_menu_xpath = (
                    "//div[contains(@class, 'x1yztbdb')]//div[@role='button' and @aria-haspopup='menu']"
                )

                menu_buttons = self.driver.find_elements(By.XPATH, menu_btn_xpath)
                if not menu_buttons:
                    menu_buttons = self.driver.find_elements(By.XPATH, alt_menu_xpath)

                if not menu_buttons:
                    self._log("No more menu buttons found")
                    break

                # Process found buttons
                for menu_btn in menu_buttons:
                    if unfollowed_count >= max_count:
                        break

                    try:
                        # Scroll into view and click
                        self.driver.execute_script(
                            "arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});",
                            menu_btn
                        )
                        self._random_delay(0.5, 1)

                        menu_btn.click()
                        self._random_delay(0.5, 1)

                        # Find "Unfollow" option in dropdown
                        unfollow_xpath = (
                            "//span[contains(text(), 'Unfollow') or "
                            "contains(text(), 'Bỏ theo dõi')]"
                        )
                        unfollow_option = self._wait_for_element(unfollow_xpath, timeout=5)

                        if unfollow_option:
                            unfollow_option.click()
                            self._random_delay(0.5, 1)

                            # Handle confirmation popup if any
                            self._handle_popup()

                            unfollowed_count += 1
                            self._log(f"✓ Unfollowed #{unfollowed_count}")
                            self._random_delay()

                        else:
                            # Close menu if unfollow not found
                            self.driver.execute_script(
                                "document.body.click();"
                            )
                            self._random_delay(0.3, 0.5)

                    except StaleElementReferenceException:
                        # Element became stale, continue to next
                        continue
                    except Exception as e:
                        self.logger.debug(f"Error processing menu button: {e}")
                        continue

                # Scroll to load more
                self.scroll_page()
                pause = random.uniform(
                    settings.scroll_pause_min,
                    settings.scroll_pause_max
                )
                time.sleep(pause)

                # Log progress
                if scroll_num % 3 == 0 and scroll_num > 0:
                    self._log(f"Scrolls: {scroll_num + 1}, Unfollowed: {unfollowed_count}")

            self._log(f"Done! Total unfollowed: {unfollowed_count}")
            return unfollowed_count

        except Exception as e:
            self._log(f"Error unfollowing users: {e}", logging.ERROR)
            return unfollowed_count

    def process_task(
        self,
        account: Account,
        task_config: TaskConfig,
        daily_remaining: int = None
    ) -> TaskResult:
        """
        Process a task based on the action type.

        This is the main dispatcher method that routes to specific actions.

        Args:
            account: Account to use for the task.
            task_config: Configuration specifying the action and parameters.
            daily_remaining: Remaining actions for today (for INVITE action).

        Returns:
            TaskResult with outcome details.
        """
        start_time = time.time()
        result = TaskResult(account=account)

        try:
            account.set_running()

            # Check for checkpoint first
            if self.check_checkpoint():
                account.set_checkpoint()
                result.error = "Checkpoint"
                return result

            success = False
            action_count = 0

            # Dispatch based on action type
            if task_config.action_type == ActionType.INVITE:
                # Use existing invite logic - try task_config URL first, then fall back to account URL
                target_url = task_config.target_url or account.group_url
                if not target_url:
                    self._log("No group URL configured", logging.ERROR)
                    account.set_error("No group URL configured")
                    result.error = "No group URL"
                    return result

                self._log(f"Navigating to group: {target_url}")
                if not self.navigate_to_group(target_url):
                    account.set_error("Navigation failed")
                    result.error = "Navigation failed"
                    return result

                scrolls, invites = self.scroll_and_invite(
                    max_clicks=task_config.max_count,
                    daily_remaining=daily_remaining
                )
                action_count = invites
                success = invites > 0

            elif task_config.action_type == ActionType.POST_WALL:
                if not task_config.content:
                    result.error = "No content provided"
                    return result
                success = self.post_to_wall(task_config.content)
                action_count = 1 if success else 0

            elif task_config.action_type == ActionType.POST_GROUP:
                if not task_config.target_url or not task_config.content:
                    result.error = "Missing group URL or content"
                    return result
                success = self.post_to_group(task_config.target_url, task_config.content)
                action_count = 1 if success else 0

            elif task_config.action_type == ActionType.SHARE:
                if not task_config.target_url:
                    result.error = "No post URL provided"
                    return result
                success = self.share_post(task_config.target_url)
                action_count = 1 if success else 0

            elif task_config.action_type == ActionType.COMMENT:
                if not task_config.target_url or not task_config.content:
                    result.error = "Missing post URL or content"
                    return result
                success = self.comment_on_post(task_config.target_url, task_config.content)
                action_count = 1 if success else 0

            elif task_config.action_type == ActionType.UNFOLLOW:
                if not task_config.target_url:
                    result.error = "No following page URL provided"
                    return result
                action_count = self.unfollow_users(
                    task_config.target_url,
                    max_count=task_config.max_count
                )
                success = action_count > 0

            else:
                result.error = f"Unknown action type: {task_config.action_type}"
                return result

            # Update result
            result.success = success
            result.invites_sent = action_count  # Reusing field for action count
            result.duration = time.time() - start_time

            if success:
                account.set_completed(action_count)
                self._log(f"Task done: {action_count} actions in {result.duration:.1f}s")
            else:
                account.set_error("Task failed")
                result.error = "Task failed"

        except Exception as e:
            error_msg = str(e)
            self._log(f"Error processing task: {error_msg}", logging.ERROR)
            account.set_error(error_msg)
            result.error = error_msg
            result.duration = time.time() - start_time

        return result

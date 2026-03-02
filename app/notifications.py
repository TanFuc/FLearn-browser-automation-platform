"""
Notifications Module.

Handles sending notifications via Telegram for important events
like batch completion, checkpoints, and errors.
"""

import logging
import threading
from datetime import datetime
from typing import Optional
from urllib.parse import quote
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
import json

from app.config import settings


class TelegramNotifier:
    """
    Sends notifications via Telegram Bot API.

    Attributes:
        bot_token: Telegram bot token.
        chat_id: Target chat ID.
        logger: Logger instance.
    """

    API_URL = "https://api.telegram.org/bot{token}/{method}"

    def __init__(
        self,
        bot_token: str = None,
        chat_id: str = None,
        logger: Optional[logging.Logger] = None
    ) -> None:
        """
        Initialize TelegramNotifier.

        Args:
            bot_token: Telegram bot token (from BotFather).
            chat_id: Target chat ID.
            logger: Optional logger instance.
        """
        self.bot_token = bot_token or settings.telegram_bot_token
        self.chat_id = chat_id or settings.telegram_chat_id
        self.logger = logger or logging.getLogger(__name__)

    def is_configured(self) -> bool:
        """Check if Telegram is properly configured."""
        return bool(
            settings.telegram_enabled and
            self.bot_token and
            self.chat_id
        )

    def _call_api(self, method: str, params: dict) -> bool:
        """
        Call Telegram Bot API.

        Args:
            method: API method name.
            params: Request parameters.

        Returns:
            True if successful, False otherwise.
        """
        if not self.is_configured():
            return False

        try:
            url = self.API_URL.format(token=self.bot_token, method=method)

            # Build query string
            query = "&".join(f"{k}={quote(str(v))}" for k, v in params.items())
            full_url = f"{url}?{query}"

            request = Request(full_url, method="GET")
            request.add_header("User-Agent", "FB-Auto-Invite-Bot/1.0")

            with urlopen(request, timeout=10) as response:
                result = json.loads(response.read().decode())
                if result.get("ok"):
                    return True
                else:
                    self.logger.warning(f"Telegram API error: {result}")
                    return False

        except HTTPError as e:
            self.logger.error(f"Telegram HTTP error: {e.code} - {e.reason}")
            return False
        except URLError as e:
            self.logger.error(f"Telegram connection error: {e.reason}")
            return False
        except Exception as e:
            self.logger.error(f"Telegram error: {e}")
            return False

    def send_message(self, text: str, parse_mode: str = "HTML") -> bool:
        """
        Send a text message.

        Args:
            text: Message text.
            parse_mode: Message format (HTML or Markdown).

        Returns:
            True if sent successfully.
        """
        if not self.is_configured():
            self.logger.debug("Telegram not configured, skipping notification")
            return False

        params = {
            "chat_id": self.chat_id,
            "text": text,
            "parse_mode": parse_mode,
            "disable_web_page_preview": "true"
        }

        return self._call_api("sendMessage", params)

    def send_async(self, text: str) -> None:
        """
        Send message asynchronously (non-blocking).

        Args:
            text: Message text.
        """
        thread = threading.Thread(
            target=self.send_message,
            args=(text,),
            daemon=True
        )
        thread.start()

    def notify_batch_complete(
        self,
        batch_num: int,
        successful: int,
        failed: int,
        total_invites: int,
        duration: float
    ) -> None:
        """
        Send notification when a batch completes.

        Args:
            batch_num: Batch number.
            successful: Number of successful accounts.
            failed: Number of failed accounts.
            total_invites: Total invites sent.
            duration: Duration in seconds.
        """
        if not settings.notify_on_complete:
            return

        status_emoji = "✅" if failed == 0 else "⚠️" if failed < successful else "❌"

        message = (
            f"{status_emoji} <b>Batch {batch_num} Complete</b>\n\n"
            f"✅ Successful: {successful}\n"
            f"❌ Failed: {failed}\n"
            f"📨 Invites Sent: {total_invites}\n"
            f"⏱ Duration: {duration:.1f}s\n"
            f"🕐 Time: {datetime.now().strftime('%H:%M:%S')}"
        )

        self.send_async(message)

    def notify_run_complete(
        self,
        total_batches: int,
        total_successful: int,
        total_failed: int,
        total_invites: int
    ) -> None:
        """
        Send notification when entire run completes.

        Args:
            total_batches: Number of batches processed.
            total_successful: Total successful accounts.
            total_failed: Total failed accounts.
            total_invites: Total invites sent.
        """
        if not settings.notify_on_complete:
            return

        message = (
            f"🏁 <b>Run Complete</b>\n\n"
            f"📦 Batches: {total_batches}\n"
            f"✅ Successful: {total_successful}\n"
            f"❌ Failed: {total_failed}\n"
            f"📨 Total Invites: {total_invites}\n"
            f"🕐 Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        )

        self.send_async(message)

    def notify_checkpoint(self, account_address: str) -> None:
        """
        Send notification when checkpoint is detected.

        Args:
            account_address: Account that hit checkpoint.
        """
        if not settings.notify_on_checkpoint:
            return

        message = (
            f"🚨 <b>Checkpoint Detected</b>\n\n"
            f"Account: <code>{account_address}</code>\n"
            f"🕐 Time: {datetime.now().strftime('%H:%M:%S')}\n\n"
            f"Action required: Please verify the account manually."
        )

        self.send_async(message)

    def notify_login_required(self, account_address: str) -> None:
        """
        Send notification when an account needs manual login (no credentials stored).

        Args:
            account_address: Account that needs login.
        """
        if not settings.notify_on_login:
            return

        message = (
            f"🔒 <b>Login Required</b>\n\n"
            f"Account: <code>{account_address}</code>\n"
            f"Status: Session expired, no credentials stored.\n"
            f"🕐 Time: {datetime.now().strftime('%H:%M:%S')}\n\n"
            f"Action: Please add FB credentials in the app settings."
        )

        self.send_async(message)

    def notify_login_success(self, account_address: str) -> None:
        """
        Send notification when auto-login succeeds.

        Args:
            account_address: Account that was logged in.
        """
        if not settings.notify_on_login:
            return

        message = (
            f"✅ <b>Auto-Login Successful</b>\n\n"
            f"Account: <code>{account_address}</code>\n"
            f"🕐 Time: {datetime.now().strftime('%H:%M:%S')}\n\n"
            f"The bot has successfully re-logged into Facebook."
        )

        self.send_async(message)

    def notify_login_failed(self, account_address: str, reason: str) -> None:
        """
        Send notification when auto-login fails.

        Args:
            account_address: Account that failed to login.
            reason: Reason for failure.
        """
        if not settings.notify_on_login:
            return

        message = (
            f"❌ <b>Auto-Login Failed</b>\n\n"
            f"Account: <code>{account_address}</code>\n"
            f"Reason: {reason}\n"
            f"🕐 Time: {datetime.now().strftime('%H:%M:%S')}\n\n"
            f"Action: Please check credentials or login manually."
        )

        self.send_async(message)

    def notify_error(self, error: str, context: str = None) -> None:
        """
        Send notification for critical errors.

        Args:
            error: Error message.
            context: Additional context.
        """
        message = f"❌ <b>Error</b>\n\n{error}"

        if context:
            message += f"\n\nContext: {context}"

        message += f"\n🕐 Time: {datetime.now().strftime('%H:%M:%S')}"

        self.send_async(message)

    def notify_daily_summary(
        self,
        total_invites: int,
        accounts_used: int,
        checkpoints: int
    ) -> None:
        """
        Send daily summary notification.

        Args:
            total_invites: Total invites today.
            accounts_used: Number of accounts used.
            checkpoints: Number of checkpoints hit.
        """
        message = (
            f"📊 <b>Daily Summary</b>\n\n"
            f"📨 Invites Sent: {total_invites}\n"
            f"👥 Accounts Used: {accounts_used}\n"
            f"🚨 Checkpoints: {checkpoints}\n"
            f"📅 Date: {datetime.now().strftime('%Y-%m-%d')}"
        )

        self.send_async(message)

    def test_connection(self) -> bool:
        """
        Test Telegram connection by sending a test message.

        Returns:
            True if test successful.
        """
        return self.send_message(
            "✅ <b>Connection Test</b>\n\n"
            "FB Auto Invite bot is connected and working!"
        )


# Global notifier instance
notifier = TelegramNotifier()

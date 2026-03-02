"""
Domain Models Module.

Defines Pydantic models for core domain objects including Account, Proxy,
and TaskStatus with proper validation and serialization.
"""

from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class AccountStatus(str, Enum):
    """Possible states for a Facebook account."""

    IDLE = "idle"
    RUNNING = "running"
    OK = "OK"
    CHECKPOINT = "Checkpoint"
    ERROR = "error"
    PROXY_DEAD = "proxy_dead"
    LOGGED_OUT = "logged_out"


class ActionType(str, Enum):
    """Types of automation actions available."""

    INVITE = "invite"
    POST_WALL = "post_wall"
    POST_GROUP = "post_group"
    SHARE = "share"
    COMMENT = "comment"
    UNFOLLOW = "unfollow"


class ProxyProtocol(str, Enum):
    """Supported proxy protocols."""

    HTTP = "http"
    HTTPS = "https"
    SOCKS4 = "socks4"
    SOCKS5 = "socks5"


class Proxy(BaseModel):
    """
    Proxy server model with validation and status tracking.

    Attributes:
        ip: Proxy server IP address.
        port: Proxy server port.
        protocol: Proxy protocol (http, https, socks4, socks5).
        last_checked: Timestamp of last connectivity check.
        is_alive: Whether the proxy is currently working.
        response_time: Last measured response time in seconds.
    """

    ip: str = Field(..., description="Proxy IP address")
    port: int = Field(..., ge=1, le=65535, description="Proxy port")
    protocol: ProxyProtocol = Field(default=ProxyProtocol.HTTP, description="Proxy protocol")
    last_checked: Optional[datetime] = Field(default=None, description="Last check timestamp")
    is_alive: bool = Field(default=False, description="Proxy health status")
    response_time: Optional[float] = Field(default=None, ge=0, description="Response time in seconds")

    @field_validator("ip", mode="before")
    @classmethod
    def validate_ip(cls, v: str) -> str:
        """Validate IP address format."""
        parts = v.split(".")
        if len(parts) != 4:
            raise ValueError("Invalid IP address format")
        for part in parts:
            try:
                num = int(part)
                if not 0 <= num <= 255:
                    raise ValueError("IP octet out of range")
            except ValueError:
                raise ValueError("Invalid IP address format")
        return v

    @property
    def address(self) -> str:
        """Get proxy address in ip:port format."""
        return f"{self.ip}:{self.port}"

    @property
    def url(self) -> str:
        """Get full proxy URL with protocol."""
        return f"{self.protocol.value}://{self.ip}:{self.port}"

    def mark_alive(self, response_time: Optional[float] = None) -> None:
        """Mark proxy as alive with current timestamp."""
        self.is_alive = True
        self.last_checked = datetime.now()
        if response_time is not None:
            self.response_time = response_time

    def mark_dead(self) -> None:
        """Mark proxy as dead with current timestamp."""
        self.is_alive = False
        self.last_checked = datetime.now()
        self.response_time = None

    @classmethod
    def from_string(cls, proxy_str: str, protocol: ProxyProtocol = ProxyProtocol.HTTP) -> "Proxy":
        """
        Create Proxy from 'ip:port' string format.

        Args:
            proxy_str: Proxy string in 'ip:port' format.
            protocol: Proxy protocol to use.

        Returns:
            Proxy instance.

        Raises:
            ValueError: If proxy string format is invalid.
        """
        # Handle format with timestamp: "ip:port | timestamp"
        if "|" in proxy_str:
            proxy_str = proxy_str.split("|")[0].strip()

        parts = proxy_str.strip().split(":")
        if len(parts) != 2:
            raise ValueError(f"Invalid proxy format: {proxy_str}")

        ip, port_str = parts
        try:
            port = int(port_str)
        except ValueError:
            raise ValueError(f"Invalid port number: {port_str}")

        return cls(ip=ip, port=port, protocol=protocol)

    def __str__(self) -> str:
        return self.address

    def __hash__(self) -> int:
        return hash((self.ip, self.port))

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Proxy):
            return False
        return self.ip == other.ip and self.port == other.port


class Account(BaseModel):
    """
    Facebook account model for automation.

    Attributes:
        debugger_address: Chrome remote debugging address (host:port).
        group_url: Facebook group URL to invite from (legacy single URL).
        group_urls: List of group URLs for multi-group support.
        proxy: Optional proxy server assigned to this account.
        status: Current account status.
        last_run: Timestamp of last automation run.
        invites_sent: Number of invites sent in last run.
        error_message: Last error message if any.
        label: Human-readable account label/name.
        notes: User notes about this account.
    """

    debugger_address: str = Field(..., description="Chrome debugger address (host:port)")
    group_url: Optional[str] = Field(default=None, description="Facebook group URL (legacy)")
    group_urls: List[str] = Field(default_factory=list, description="Multiple group URLs")
    proxy: Optional[Proxy] = Field(default=None, description="Assigned proxy")
    status: AccountStatus = Field(default=AccountStatus.IDLE, description="Account status")
    last_run: Optional[datetime] = Field(default=None, description="Last run timestamp")
    invites_sent: int = Field(default=0, ge=0, description="Invites sent in last run")
    error_message: Optional[str] = Field(default=None, description="Last error message")
    label: Optional[str] = Field(default=None, description="Human-readable account label")
    notes: Optional[str] = Field(default=None, description="User notes about this account")

    # Auto-login credentials (password is encrypted with Fernet)
    fb_email: Optional[str] = Field(default=None, description="Facebook email/phone for auto-login")
    fb_password_enc: Optional[str] = Field(default=None, description="Encrypted Facebook password")
    login_attempts: int = Field(default=0, ge=0, description="Login attempts in current session")
    last_login_at: Optional[datetime] = Field(default=None, description="Last successful login timestamp")

    @property
    def port(self) -> int:
        """Extract port number from debugger address."""
        return int(self.debugger_address.split(":")[-1])

    @property
    def host(self) -> str:
        """Extract host from debugger address."""
        parts = self.debugger_address.split(":")
        return parts[0] if len(parts) > 1 else "127.0.0.1"

    def set_running(self) -> None:
        """Mark account as currently running."""
        self.status = AccountStatus.RUNNING
        self.error_message = None

    def set_completed(self, invites: int) -> None:
        """Mark account as completed successfully."""
        self.status = AccountStatus.OK
        self.invites_sent = invites
        self.last_run = datetime.now()
        self.error_message = None

    def set_checkpoint(self) -> None:
        """Mark account as requiring checkpoint verification."""
        self.status = AccountStatus.CHECKPOINT
        self.last_run = datetime.now()

    def set_error(self, message: str) -> None:
        """Mark account as having an error."""
        self.status = AccountStatus.ERROR
        self.error_message = message
        self.last_run = datetime.now()

    def set_proxy_dead(self) -> None:
        """Mark account as having a dead proxy."""
        self.status = AccountStatus.PROXY_DEAD
        self.last_run = datetime.now()

    def set_logged_out(self) -> None:
        """Mark account as logged out (session expired)."""
        self.status = AccountStatus.LOGGED_OUT
        self.last_run = datetime.now()

    def set_login_failed(self, message: str) -> None:
        """Mark account as login failed."""
        self.status = AccountStatus.ERROR
        self.error_message = f"Login failed: {message}"
        self.last_run = datetime.now()

    def set_login_success(self) -> None:
        """Mark successful login, reset attempts counter."""
        self.login_attempts = 0
        self.last_login_at = datetime.now()
        self.error_message = None

    @property
    def has_credentials(self) -> bool:
        """Check if account has stored login credentials."""
        return bool(self.fb_email and self.fb_password_enc)

    def assign_proxy(self, proxy: Proxy) -> None:
        """Assign a proxy to this account."""
        self.proxy = proxy

    def clear_proxy(self) -> None:
        """Remove proxy assignment."""
        self.proxy = None

    def get_effective_group_urls(self) -> List[str]:
        """
        Get list of group URLs to process.

        Returns group_urls if set, otherwise falls back to single group_url.

        Returns:
            List of group URLs.
        """
        if self.group_urls:
            return self.group_urls
        if self.group_url:
            return [self.group_url]
        return []

    @property
    def display_name(self) -> str:
        """Get display name (label or debugger address)."""
        return self.label or self.debugger_address

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        data = {
            "debugger_address": self.debugger_address,
            "group_url": self.group_url,
            "proxy": self.proxy.address if self.proxy else None,
            "status": self.status.value
        }
        # Only include optional fields if they have values
        if self.group_urls:
            data["group_urls"] = self.group_urls
        if self.label:
            data["label"] = self.label
        if self.notes:
            data["notes"] = self.notes
        # Auto-login credentials (password is already encrypted)
        if self.fb_email:
            data["fb_email"] = self.fb_email
        if self.fb_password_enc:
            data["fb_password_enc"] = self.fb_password_enc
        if self.login_attempts > 0:
            data["login_attempts"] = self.login_attempts
        if self.last_login_at:
            data["last_login_at"] = self.last_login_at.isoformat()
        return data

    @classmethod
    def from_dict(cls, data: dict) -> "Account":
        """Create Account from dictionary."""
        proxy = None
        if data.get("proxy"):
            try:
                proxy = Proxy.from_string(data["proxy"])
            except ValueError:
                pass

        status = AccountStatus.IDLE
        if data.get("status"):
            try:
                status = AccountStatus(data["status"])
            except ValueError:
                pass

        # Parse last_login_at if present
        last_login_at = None
        if data.get("last_login_at"):
            try:
                last_login_at = datetime.fromisoformat(data["last_login_at"])
            except (ValueError, TypeError):
                pass

        return cls(
            debugger_address=data["debugger_address"],
            group_url=data.get("group_url"),
            group_urls=data.get("group_urls", []),
            proxy=proxy,
            status=status,
            label=data.get("label"),
            notes=data.get("notes"),
            # Auto-login fields
            fb_email=data.get("fb_email"),
            fb_password_enc=data.get("fb_password_enc"),
            login_attempts=data.get("login_attempts", 0),
            last_login_at=last_login_at
        )


class TaskResult(BaseModel):
    """
    Result of a single account processing task.

    Attributes:
        account: The processed account.
        success: Whether the task completed successfully.
        invites_sent: Number of invites successfully sent.
        duration: Task duration in seconds.
        error: Error message if task failed.
    """

    account: Account
    success: bool = Field(default=False)
    invites_sent: int = Field(default=0, ge=0)
    duration: float = Field(default=0.0, ge=0)
    error: Optional[str] = Field(default=None)


class BatchResult(BaseModel):
    """
    Result of a batch processing run.

    Attributes:
        batch_number: Sequential batch number.
        total_accounts: Number of accounts in batch.
        successful: Number of successfully processed accounts.
        failed: Number of failed accounts.
        total_invites: Total invites sent in batch.
        duration: Batch duration in seconds.
        results: Individual task results.
    """

    batch_number: int = Field(ge=1)
    total_accounts: int = Field(ge=0)
    successful: int = Field(default=0, ge=0)
    failed: int = Field(default=0, ge=0)
    total_invites: int = Field(default=0, ge=0)
    duration: float = Field(default=0.0, ge=0)
    results: list[TaskResult] = Field(default_factory=list)


class TaskConfig(BaseModel):
    """
    Configuration for an automation task.

    Holds the action type, target URL, and content for different
    automation operations (post, comment, share, unfollow, invite).

    Attributes:
        action_type: Type of action to perform.
        target_url: URL to act upon (group, post, following page).
        content: Text content for posts or comments.
        max_count: Maximum number of actions (invites, unfollows).
    """

    action_type: ActionType = Field(default=ActionType.INVITE, description="Action to perform")
    target_url: Optional[str] = Field(default=None, description="Target URL for the action")
    content: Optional[str] = Field(default=None, description="Content for posts/comments")
    max_count: int = Field(default=50, ge=1, description="Max actions to perform")

    @property
    def action_label(self) -> str:
        """Get human-readable action label."""
        labels = {
            ActionType.INVITE: "Invite Friends",
            ActionType.POST_WALL: "Post to Wall",
            ActionType.POST_GROUP: "Post to Group",
            ActionType.SHARE: "Share Post",
            ActionType.COMMENT: "Comment on Post",
            ActionType.UNFOLLOW: "Unfollow Users",
        }
        return labels.get(self.action_type, "Unknown")

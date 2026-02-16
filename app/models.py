"""
Domain Models Module.

Defines Pydantic models for core domain objects including Account, Proxy,
and TaskStatus with proper validation and serialization.
"""

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class AccountStatus(str, Enum):
    """Possible states for a Facebook account."""

    IDLE = "idle"
    RUNNING = "running"
    OK = "OK"
    CHECKPOINT = "Checkpoint"
    ERROR = "error"
    PROXY_DEAD = "proxy_dead"


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
        group_url: Facebook group URL to invite from.
        proxy: Optional proxy server assigned to this account.
        status: Current account status.
        last_run: Timestamp of last automation run.
        invites_sent: Number of invites sent in last run.
        error_message: Last error message if any.
    """

    debugger_address: str = Field(..., description="Chrome debugger address (host:port)")
    group_url: Optional[str] = Field(default=None, description="Facebook group URL")
    proxy: Optional[Proxy] = Field(default=None, description="Assigned proxy")
    status: AccountStatus = Field(default=AccountStatus.IDLE, description="Account status")
    last_run: Optional[datetime] = Field(default=None, description="Last run timestamp")
    invites_sent: int = Field(default=0, ge=0, description="Invites sent in last run")
    error_message: Optional[str] = Field(default=None, description="Last error message")

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

    def assign_proxy(self, proxy: Proxy) -> None:
        """Assign a proxy to this account."""
        self.proxy = proxy

    def clear_proxy(self) -> None:
        """Remove proxy assignment."""
        self.proxy = None

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "debugger_address": self.debugger_address,
            "group_url": self.group_url,
            "proxy": self.proxy.address if self.proxy else None,
            "status": self.status.value
        }

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

        return cls(
            debugger_address=data["debugger_address"],
            group_url=data.get("group_url"),
            proxy=proxy,
            status=status
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

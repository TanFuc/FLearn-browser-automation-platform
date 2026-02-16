"""
Configuration Management Module.

Uses Pydantic BaseSettings to load configuration from environment variables
and .env files, with sensible defaults for development.
"""

from pathlib import Path
from typing import List, Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class AppSettings(BaseSettings):
    """
    Application settings loaded from environment variables and .env file.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore"
    )

    # ========== Chrome/Browser Settings ==========
    chromedriver_path: Path = Field(
        default=Path(r"C:\Tools\ChromeDriver142\chromedriver.exe"),
        description="Path to ChromeDriver executable"
    )
    chrome_binary_path: Path = Field(
        default=Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
        description="Path to Chrome browser executable"
    )
    profile_dir: Path = Field(
        default=Path(r"C:\ChromeProfiles"),
        description="Base directory for Chrome profiles"
    )
    headless: bool = Field(default=False, description="Run Chrome in headless mode")
    user_agent_rotate: bool = Field(default=True, description="Enable User-Agent rotation")
    disable_images: bool = Field(default=False, description="Disable images for faster loading")
    window_size: str = Field(default="1280,720", description="Browser window size")

    # ========== Batch Processing Settings ==========
    batch_size: int = Field(default=5, ge=1, le=20, description="Accounts per batch")
    max_clicks: int = Field(default=50, ge=1, le=200, description="Max clicks per account per run")
    max_scrolls: int = Field(default=999, ge=1, description="Max scroll iterations")
    max_retries: int = Field(default=3, ge=1, le=10, description="Max retries on failure")

    # ========== Daily Limits & Anti-Ban ==========
    daily_max_invites: int = Field(default=100, ge=1, le=500, description="Max invites per account per day")
    warmup_enabled: bool = Field(default=True, description="Enable warmup for new accounts")
    warmup_initial_limit: int = Field(default=10, ge=1, description="Initial limit for new accounts")

    # ========== Timing Settings (seconds) ==========
    scroll_pause_min: float = Field(default=3.5, ge=0.5, description="Min scroll pause")
    scroll_pause_max: float = Field(default=6.0, ge=1.0, description="Max scroll pause")
    click_delay_min: float = Field(default=1.8, ge=0.5, description="Min click delay")
    click_delay_max: float = Field(default=5.0, ge=1.0, description="Max click delay")
    batch_rest_min: int = Field(default=90, ge=30, description="Min batch rest seconds")
    batch_rest_max: int = Field(default=180, ge=60, description="Max batch rest seconds")

    # ========== Scheduler Settings ==========
    scheduler_enabled: bool = Field(default=False, description="Enable scheduler")
    scheduler_start_time: str = Field(default="08:00", description="Start time (HH:MM)")
    scheduler_end_time: str = Field(default="22:00", description="End time (HH:MM)")
    scheduler_pause_days: List[str] = Field(
        default=["Sunday"],
        description="Days to pause (Sunday, Monday, etc.)"
    )

    # ========== Filtering Settings ==========
    skip_admins: bool = Field(default=True, description="Skip group admins/moderators")
    skip_verified: bool = Field(default=False, description="Skip verified accounts")
    keywords_blacklist: List[str] = Field(
        default=["shop", "store", "sell"],
        description="Skip profiles containing these keywords"
    )

    # ========== Proxy Settings ==========
    use_proxy: bool = Field(default=True, description="Enable/disable proxy usage globally")
    proxy_fallback_to_direct: bool = Field(default=False, description="Fallback to direct connection if proxy fails")
    proxy_test_timeout: int = Field(default=12, ge=5, le=60, description="Proxy test timeout")
    proxy_max_threads: int = Field(default=60, ge=1, le=200, description="Max proxy test threads")
    proxy_max_runtime: int = Field(default=600, ge=60, description="Max proxy runtime seconds")
    proxy_valid_ports: List[int] = Field(
        default=[80, 8080, 3128],
        description="Valid proxy ports"
    )
    proxy_needed_count: int = Field(default=5, ge=1, description="Minimum proxies needed")
    proxy_retry_count: int = Field(default=3, ge=1, description="Proxy connection retries")

    # ========== Notification Settings ==========
    telegram_enabled: bool = Field(default=False, description="Enable Telegram notifications")
    telegram_bot_token: str = Field(default="", description="Telegram bot token")
    telegram_chat_id: str = Field(default="", description="Telegram chat ID")
    notify_on_complete: bool = Field(default=True, description="Notify when batch completes")
    notify_on_checkpoint: bool = Field(default=True, description="Notify on checkpoint detection")

    # ========== File Paths ==========
    account_status_file: Path = Field(
        default=Path("account_status.json"),
        description="Account status file"
    )
    database_file: Path = Field(default=Path("fb_auto_invite.db"), description="SQLite database file")
    proxy_best_file: Path = Field(default=Path("proxies_best.txt"))
    proxy_good_file: Path = Field(default=Path("proxies_good.txt"))
    proxy_bad_file: Path = Field(default=Path("proxies_bad.txt"))
    proxy_alive_file: Path = Field(default=Path("proxies_alive.txt"))
    log_file: Path = Field(default=Path("app.log"))

    # ========== Debug Mode ==========
    debug_mode: bool = Field(default=False, description="Enable debug logging")

    @field_validator("chromedriver_path", "chrome_binary_path", mode="before")
    @classmethod
    def validate_executable_paths(cls, v: str | Path) -> Path:
        """Validate that executable paths are valid."""
        path = Path(v) if isinstance(v, str) else v
        return path

    @field_validator("profile_dir", mode="before")
    @classmethod
    def validate_directory_path(cls, v: str | Path) -> Path:
        """Validate and create directory if needed."""
        path = Path(v) if isinstance(v, str) else v
        return path

    def get_profile_path(self, port: int) -> Path:
        """
        Get the Chrome profile directory for a specific debugging port.

        Args:
            port: The debugging port number.

        Returns:
            Path to the profile directory.
        """
        return self.profile_dir / f"acc_{port}"

    def ensure_directories(self) -> None:
        """Create necessary directories if they don't exist."""
        self.profile_dir.mkdir(parents=True, exist_ok=True)


# Global settings instance
settings = AppSettings()

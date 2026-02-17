"""
Configuration Management Module.

Uses Pydantic BaseSettings to load configuration from environment variables
and .env files, with sensible defaults for development.
Supports user overrides via user_settings.json.
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# User settings file path
USER_SETTINGS_FILE = Path("user_settings.json")


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
    max_scrolls: int = Field(default=50, ge=1, description="Max scroll iterations")
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

    # ========== Auto Loop Settings ==========
    auto_loop_enabled: bool = Field(default=False, description="Enable auto loop")
    auto_loop_interval_minutes: int = Field(
        default=60, ge=5, le=1440,
        description="Minutes between loop runs (5-1440)"
    )
    auto_loop_max_runs: int = Field(
        default=0, ge=0,
        description="Max loop runs (0 = unlimited)"
    )

    # ========== Sequential Processing Settings ==========
    concurrent_browsers: int = Field(
        default=2, ge=1, le=10,
        description="Number of browsers to run simultaneously"
    )
    close_browser_after_account: bool = Field(
        default=True,
        description="Close browser after each account completes"
    )
    rest_between_accounts: int = Field(
        default=30, ge=10, le=300,
        description="Seconds to rest between account batches"
    )

    # ========== Anti-Detection Settings ==========
    human_typing_enabled: bool = Field(default=True, description="Enable human-like typing")
    random_mouse_movements: bool = Field(default=True, description="Add random mouse movements")
    action_delay_min: float = Field(default=2.0, ge=0.5, description="Min delay between actions")
    action_delay_max: float = Field(default=5.0, ge=1.0, description="Max delay between actions")
    scroll_variation: bool = Field(default=True, description="Vary scroll amounts")
    random_breaks_enabled: bool = Field(default=True, description="Take random breaks")
    break_chance_percent: int = Field(default=10, ge=0, le=50, description="Chance of random break (%)")
    break_duration_min: int = Field(default=30, ge=10, description="Min break duration (seconds)")
    break_duration_max: int = Field(default=120, ge=30, description="Max break duration (seconds)")

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

    def save_to_file(self, file_path: Path = None) -> bool:
        """
        Save current settings to a JSON file.

        Args:
            file_path: Path to save settings to. Defaults to USER_SETTINGS_FILE.

        Returns:
            True if saved successfully, False otherwise.
        """
        file_path = file_path or USER_SETTINGS_FILE
        logger = logging.getLogger(__name__)

        try:
            # Get all settings as dict, converting Path objects to strings
            data = {}
            for field_name in self.model_fields:
                value = getattr(self, field_name)
                if isinstance(value, Path):
                    data[field_name] = str(value)
                else:
                    data[field_name] = value

            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

            logger.info(f"Settings saved to {file_path}")
            return True

        except Exception as e:
            logger.error(f"Error saving settings: {e}")
            return False

    def update_from_dict(self, data: Dict[str, Any]) -> None:
        """
        Update settings from a dictionary.

        Args:
            data: Dictionary of setting names and values.
        """
        for key, value in data.items():
            if hasattr(self, key):
                # Convert string paths back to Path objects
                field_info = self.model_fields.get(key)
                if field_info and field_info.annotation == Path:
                    value = Path(value)
                setattr(self, key, value)

    def to_ui_dict(self) -> Dict[str, Any]:
        """
        Get settings as a dictionary suitable for UI display.

        Returns:
            Dictionary with setting values (Paths converted to strings).
        """
        data = {}
        for field_name in self.model_fields:
            value = getattr(self, field_name)
            if isinstance(value, Path):
                data[field_name] = str(value)
            else:
                data[field_name] = value
        return data


def load_user_settings() -> Dict[str, Any]:
    """
    Load user settings from JSON file.

    Returns:
        Dictionary of user settings, empty if file doesn't exist.
    """
    if not USER_SETTINGS_FILE.exists():
        return {}

    try:
        with open(USER_SETTINGS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logging.getLogger(__name__).warning(f"Error loading user settings: {e}")
        return {}


def create_settings() -> AppSettings:
    """
    Create AppSettings instance with user overrides applied.

    Returns:
        AppSettings instance with user settings applied.
    """
    # Create base settings from env
    base_settings = AppSettings()

    # Load and apply user overrides
    user_overrides = load_user_settings()
    if user_overrides:
        base_settings.update_from_dict(user_overrides)
        logging.getLogger(__name__).info(
            f"Applied {len(user_overrides)} user setting overrides"
        )

    return base_settings


# Global settings instance (with user overrides)
settings = create_settings()

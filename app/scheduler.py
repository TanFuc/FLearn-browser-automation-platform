"""
Scheduler Module for Time-Based Operation.

Manages scheduled execution based on configured time windows and pause days.
Simulates human behavior by only operating during specified hours.
"""

import logging
import threading
import time
from datetime import datetime, timedelta
from typing import Callable, List, Optional

from app.config import settings


class Scheduler:
    """
    Manages scheduled execution of bot operations.

    Controls when the bot can run based on:
    - Start/end time windows (e.g., 8:00 AM - 10:00 PM)
    - Pause days (e.g., Sundays)
    - Manual pause/resume

    Attributes:
        logger: Logger instance.
        is_paused: Whether scheduler is manually paused.
    """

    # Day name mapping
    DAY_NAMES = [
        "Monday", "Tuesday", "Wednesday", "Thursday",
        "Friday", "Saturday", "Sunday"
    ]

    def __init__(self, logger: Optional[logging.Logger] = None) -> None:
        """
        Initialize Scheduler.

        Args:
            logger: Optional logger instance.
        """
        self.logger = logger or logging.getLogger(__name__)
        self.is_paused = False
        self._stop_flag = threading.Event()
        self._on_status_change: Optional[Callable[[str], None]] = None

    def set_status_callback(self, callback: Callable[[str], None]) -> None:
        """Set callback for status changes."""
        self._on_status_change = callback

    def _emit_status(self, status: str) -> None:
        """Emit status change event."""
        if self._on_status_change:
            try:
                self._on_status_change(status)
            except Exception:
                pass

    def _parse_time(self, time_str: str) -> tuple:
        """
        Parse time string to (hour, minute).

        Args:
            time_str: Time string in HH:MM format.

        Returns:
            Tuple of (hour, minute).
        """
        try:
            parts = time_str.strip().split(":")
            hour = int(parts[0])
            minute = int(parts[1]) if len(parts) > 1 else 0
            if not (0 <= hour <= 23 and 0 <= minute <= 59):
                raise ValueError("Hour or minute out of range")
            return (hour, minute)
        except (ValueError, IndexError):
            self.logger.warning(f"Invalid time format: {time_str}, using default")
            return (8, 0)

    def is_within_schedule(self) -> bool:
        """
        Check if current time is within the scheduled operation window.

        Returns:
            True if within schedule, False otherwise.
        """
        if not settings.scheduler_enabled:
            return True  # If scheduler disabled, always allow

        now = datetime.now()

        # Check pause days
        current_day = self.DAY_NAMES[now.weekday()]
        if current_day in settings.scheduler_pause_days:
            self.logger.debug(f"Today ({current_day}) is a pause day")
            return False

        # Check time window
        start_hour, start_min = self._parse_time(settings.scheduler_start_time)
        end_hour, end_min = self._parse_time(settings.scheduler_end_time)

        start_time = now.replace(hour=start_hour, minute=start_min, second=0)
        end_time = now.replace(hour=end_hour, minute=end_min, second=0)

        # Handle overnight schedules (e.g., 22:00 - 06:00)
        if end_time <= start_time:
            # Check if we're after start OR before end
            return now >= start_time or now <= end_time
        else:
            # Normal schedule (e.g., 08:00 - 22:00)
            return start_time <= now <= end_time

    def get_next_window_start(self) -> Optional[datetime]:
        """
        Get the datetime when the next operation window starts.

        Returns:
            Datetime of next window start, or None if scheduler disabled.
        """
        if not settings.scheduler_enabled:
            return None

        now = datetime.now()
        start_hour, start_min = self._parse_time(settings.scheduler_start_time)

        # Start with today's start time
        next_start = now.replace(hour=start_hour, minute=start_min, second=0, microsecond=0)

        # If we're past today's start time, try tomorrow
        if now >= next_start:
            next_start += timedelta(days=1)

        # Skip pause days
        max_checks = 8  # Prevent infinite loop
        for _ in range(max_checks):
            day_name = self.DAY_NAMES[next_start.weekday()]
            if day_name not in settings.scheduler_pause_days:
                return next_start
            next_start += timedelta(days=1)

        return next_start

    def get_time_until_window(self) -> Optional[timedelta]:
        """
        Get time remaining until the next operation window.

        Returns:
            Timedelta until next window, or None if within window or disabled.
        """
        if self.is_within_schedule():
            return None

        next_start = self.get_next_window_start()
        if next_start:
            return next_start - datetime.now()
        return None

    def get_status_message(self) -> str:
        """
        Get human-readable status message.

        Returns:
            Status message string.
        """
        if not settings.scheduler_enabled:
            return "Scheduler disabled"

        if self.is_paused:
            return "Manually paused"

        if self.is_within_schedule():
            end_hour, end_min = self._parse_time(settings.scheduler_end_time)
            return f"Active until {end_hour:02d}:{end_min:02d}"

        remaining = self.get_time_until_window()
        if remaining:
            hours = int(remaining.total_seconds() // 3600)
            minutes = int((remaining.total_seconds() % 3600) // 60)

            if hours > 0:
                return f"Waiting {hours}h {minutes}m"
            else:
                return f"Waiting {minutes}m"

        return "Outside schedule"

    def can_run(self) -> bool:
        """
        Check if bot operations can run now.

        Returns:
            True if can run, False otherwise.
        """
        if self.is_paused:
            return False
        return self.is_within_schedule()

    def wait_for_window(
        self,
        check_interval: int = 60,
        on_waiting: Optional[Callable[[str], None]] = None
    ) -> bool:
        """
        Wait until the operation window opens.

        Args:
            check_interval: Seconds between status checks.
            on_waiting: Callback for status updates during wait.

        Returns:
            True when window opens, False if stopped.
        """
        self._stop_flag.clear()

        while not self.can_run():
            if self._stop_flag.is_set():
                return False

            status = self.get_status_message()
            if on_waiting:
                on_waiting(status)
            self._emit_status(status)

            self.logger.info(f"Scheduler: {status}")

            # Interruptible sleep
            for _ in range(check_interval):
                if self._stop_flag.is_set():
                    return False
                if self.can_run():
                    return True
                time.sleep(1)

        return True

    def pause(self) -> None:
        """Manually pause the scheduler."""
        self.is_paused = True
        self._emit_status("Paused")
        self.logger.info("Scheduler paused")

    def resume(self) -> None:
        """Resume the scheduler."""
        self.is_paused = False
        self._emit_status(self.get_status_message())
        self.logger.info("Scheduler resumed")

    def stop(self) -> None:
        """Stop any waiting operations."""
        self._stop_flag.set()

    def get_schedule_info(self) -> dict:
        """
        Get current schedule configuration.

        Returns:
            Dictionary with schedule info.
        """
        return {
            "enabled": settings.scheduler_enabled,
            "start_time": settings.scheduler_start_time,
            "end_time": settings.scheduler_end_time,
            "pause_days": settings.scheduler_pause_days,
            "is_paused": self.is_paused,
            "can_run": self.can_run(),
            "status": self.get_status_message()
        }


# Global scheduler instance
scheduler = Scheduler()

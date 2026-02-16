"""
Centralized Logging Configuration Module.

Provides thread-safe logging setup with support for both file and UI handlers.
Uses QueueHandler pattern for non-blocking UI updates.
"""

import logging
import sys
from datetime import datetime
from logging.handlers import QueueHandler, QueueListener, RotatingFileHandler
from pathlib import Path
from queue import Queue
from typing import Callable, Optional

from app.config import settings


class UILogHandler(logging.Handler):
    """
    Custom logging handler that forwards log records to a UI callback.

    Thread-safe handler that can be used to update UI elements (like Tkinter
    text widgets) from log messages without blocking the logging thread.

    Attributes:
        callback: Function to call with formatted log message.
    """

    def __init__(self, callback: Callable[[str], None]) -> None:
        """
        Initialize the UI log handler.

        Args:
            callback: Function that accepts a formatted log string.
        """
        super().__init__()
        self.callback = callback

    def emit(self, record: logging.LogRecord) -> None:
        """
        Emit a log record to the UI callback.

        Args:
            record: The log record to emit.
        """
        try:
            msg = self.format(record)
            self.callback(msg)
        except Exception:
            self.handleError(record)


class LogManager:
    """
    Centralized log manager for the application.

    Manages logger creation, configuration, and cleanup. Supports multiple
    output targets including console, file, and UI widgets.

    Attributes:
        log_queue: Queue for async log handling.
        queue_listener: Listener that processes queued log records.
        loggers: Dictionary of created loggers.
    """

    _instance: Optional["LogManager"] = None

    def __new__(cls) -> "LogManager":
        """Singleton pattern for log manager."""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self) -> None:
        """Initialize the log manager."""
        if self._initialized:
            return

        self.log_queue: Queue = Queue(-1)  # Unlimited size
        self.queue_listener: Optional[QueueListener] = None
        self.loggers: dict[str, logging.Logger] = {}
        self._handlers: list[logging.Handler] = []
        self._initialized = True
        self._setup_root_logger()

    def _setup_root_logger(self) -> None:
        """Configure the root logger with default handlers."""
        root = logging.getLogger()
        root.setLevel(logging.DEBUG if settings.debug_mode else logging.INFO)

        # Clear existing handlers
        root.handlers.clear()

        # Console handler
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(logging.DEBUG if settings.debug_mode else logging.INFO)
        console_formatter = logging.Formatter(
            "[%(asctime)s] [%(levelname)s] %(name)s: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S"
        )
        console_handler.setFormatter(console_formatter)
        root.addHandler(console_handler)
        self._handlers.append(console_handler)

        # File handler with rotation
        try:
            log_path = Path(settings.log_file)
            log_path.parent.mkdir(parents=True, exist_ok=True)

            file_handler = RotatingFileHandler(
                log_path,
                maxBytes=5 * 1024 * 1024,  # 5 MB
                backupCount=3,
                encoding="utf-8"
            )
            file_handler.setLevel(logging.DEBUG)
            file_formatter = logging.Formatter(
                "[%(asctime)s] [%(levelname)s] [%(name)s] [%(threadName)s] %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S"
            )
            file_handler.setFormatter(file_formatter)
            root.addHandler(file_handler)
            self._handlers.append(file_handler)
        except Exception as e:
            root.warning(f"Failed to setup file logging: {e}")

    def get_logger(self, name: str) -> logging.Logger:
        """
        Get or create a logger with the specified name.

        Args:
            name: Logger name (typically module name).

        Returns:
            Configured logger instance.
        """
        if name in self.loggers:
            return self.loggers[name]

        logger = logging.getLogger(name)
        self.loggers[name] = logger
        return logger

    def create_account_logger(
        self,
        account_id: str,
        ui_callback: Optional[Callable[[str], None]] = None
    ) -> logging.Logger:
        """
        Create a logger specific to an account with optional UI callback.

        Args:
            account_id: Unique identifier for the account (e.g., port number).
            ui_callback: Optional callback for UI updates.

        Returns:
            Configured logger for the account.
        """
        logger_name = f"account.{account_id}"
        logger = logging.getLogger(logger_name)
        logger.setLevel(logging.DEBUG if settings.debug_mode else logging.INFO)

        # Clear existing handlers to avoid duplicates
        logger.handlers.clear()
        logger.propagate = True  # Also log to root handlers

        # Add UI handler if callback provided
        if ui_callback:
            ui_handler = UILogHandler(ui_callback)
            ui_handler.setLevel(logging.INFO)
            ui_formatter = logging.Formatter(
                "[%(asctime)s] %(message)s",
                datefmt="%H:%M:%S"
            )
            ui_handler.setFormatter(ui_formatter)
            logger.addHandler(ui_handler)

        self.loggers[logger_name] = logger
        return logger

    def add_ui_handler(
        self,
        callback: Callable[[str], None],
        level: int = logging.INFO,
        logger_name: Optional[str] = None
    ) -> UILogHandler:
        """
        Add a UI handler to a logger.

        Args:
            callback: Function to call with log messages.
            level: Minimum log level for the handler.
            logger_name: Logger name (None for root logger).

        Returns:
            The created UI handler.
        """
        handler = UILogHandler(callback)
        handler.setLevel(level)
        handler.setFormatter(logging.Formatter(
            "[%(asctime)s] %(message)s",
            datefmt="%H:%M:%S"
        ))

        logger = logging.getLogger(logger_name) if logger_name else logging.getLogger()
        logger.addHandler(handler)
        self._handlers.append(handler)

        return handler

    def remove_handler(self, handler: logging.Handler, logger_name: Optional[str] = None) -> None:
        """
        Remove a handler from a logger.

        Args:
            handler: The handler to remove.
            logger_name: Logger name (None for root logger).
        """
        logger = logging.getLogger(logger_name) if logger_name else logging.getLogger()
        logger.removeHandler(handler)
        if handler in self._handlers:
            self._handlers.remove(handler)

    def start_queue_listener(self, *handlers: logging.Handler) -> None:
        """
        Start the queue listener for async logging.

        Args:
            handlers: Handlers to receive queued log records.
        """
        if self.queue_listener:
            self.queue_listener.stop()

        self.queue_listener = QueueListener(
            self.log_queue,
            *handlers,
            respect_handler_level=True
        )
        self.queue_listener.start()

    def get_queue_handler(self) -> QueueHandler:
        """
        Get a QueueHandler for thread-safe logging.

        Returns:
            QueueHandler connected to the log queue.
        """
        return QueueHandler(self.log_queue)

    def shutdown(self) -> None:
        """Cleanup logging resources."""
        if self.queue_listener:
            self.queue_listener.stop()
            self.queue_listener = None

        for handler in self._handlers:
            handler.close()
        self._handlers.clear()

        self.loggers.clear()


# Global log manager instance
log_manager = LogManager()


def get_logger(name: str) -> logging.Logger:
    """
    Convenience function to get a logger.

    Args:
        name: Logger name.

    Returns:
        Configured logger instance.
    """
    return log_manager.get_logger(name)

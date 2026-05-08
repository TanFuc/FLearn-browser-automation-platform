"""
File I/O Utilities.

Provides safe file reading and writing operations with error handling.
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

logger = logging.getLogger(__name__)


def read_json(
    file_path: Union[str, Path],
    default: Any = None,
    encoding: str = "utf-8"
) -> Any:
    """
    Safely read JSON from a file.

    Args:
        file_path: Path to the JSON file.
        default: Default value if file doesn't exist or is invalid.
        encoding: File encoding.

    Returns:
        Parsed JSON data or default value.
    """
    path = Path(file_path)

    if not path.exists():
        logger.debug(f"File not found: {path}")
        return default

    try:
        with open(path, "r", encoding=encoding) as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in {path}: {e}")
        return default
    except Exception as e:
        logger.error(f"Error reading {path}: {e}")
        return default


def write_json(
    file_path: Union[str, Path],
    data: Any,
    indent: int = 2,
    encoding: str = "utf-8",
    ensure_ascii: bool = False
) -> bool:
    """
    Safely write JSON to a file.

    Args:
        file_path: Path to the JSON file.
        data: Data to write.
        indent: JSON indentation level.
        encoding: File encoding.
        ensure_ascii: Whether to escape non-ASCII characters.

    Returns:
        True if write successful, False otherwise.
    """
    path = Path(file_path)

    try:
        # Ensure parent directory exists
        path.parent.mkdir(parents=True, exist_ok=True)

        with open(path, "w", encoding=encoding) as f:
            json.dump(data, f, indent=indent, ensure_ascii=ensure_ascii)

        return True
    except Exception as e:
        logger.error(f"Error writing to {path}: {e}")
        return False


def read_lines(
    file_path: Union[str, Path],
    strip: bool = True,
    skip_empty: bool = True,
    encoding: str = "utf-8"
) -> List[str]:
    """
    Read lines from a text file.

    Args:
        file_path: Path to the text file.
        strip: Whether to strip whitespace from lines.
        skip_empty: Whether to skip empty lines.
        encoding: File encoding.

    Returns:
        List of lines from the file.
    """
    path = Path(file_path)

    if not path.exists():
        logger.debug(f"File not found: {path}")
        return []

    try:
        with open(path, "r", encoding=encoding) as f:
            lines = f.readlines()

        if strip:
            lines = [line.strip() for line in lines]

        if skip_empty:
            lines = [line for line in lines if line]

        return lines
    except Exception as e:
        logger.error(f"Error reading {path}: {e}")
        return []


def write_lines(
    file_path: Union[str, Path],
    lines: List[str],
    encoding: str = "utf-8",
    append: bool = False
) -> bool:
    """
    Write lines to a text file.

    Args:
        file_path: Path to the text file.
        lines: Lines to write.
        encoding: File encoding.
        append: Whether to append to existing file.

    Returns:
        True if write successful, False otherwise.
    """
    path = Path(file_path)

    try:
        # Ensure parent directory exists
        path.parent.mkdir(parents=True, exist_ok=True)

        mode = "a" if append else "w"
        with open(path, mode, encoding=encoding) as f:
            for line in lines:
                f.write(f"{line}\n")

        return True
    except Exception as e:
        logger.error(f"Error writing to {path}: {e}")
        return False


def append_line(
    file_path: Union[str, Path],
    line: str,
    encoding: str = "utf-8"
) -> bool:
    """
    Append a single line to a text file.

    Args:
        file_path: Path to the text file.
        line: Line to append.
        encoding: File encoding.

    Returns:
        True if write successful, False otherwise.
    """
    path = Path(file_path)

    try:
        path.parent.mkdir(parents=True, exist_ok=True)

        with open(path, "a", encoding=encoding) as f:
            f.write(f"{line}\n")

        return True
    except Exception as e:
        logger.error(f"Error appending to {path}: {e}")
        return False


def file_exists(file_path: Union[str, Path]) -> bool:
    """
    Check if a file exists.

    Args:
        file_path: Path to check.

    Returns:
        True if file exists, False otherwise.
    """
    return Path(file_path).exists()


def ensure_directory(dir_path: Union[str, Path]) -> bool:
    """
    Ensure a directory exists, creating it if necessary.

    Args:
        dir_path: Directory path.

    Returns:
        True if directory exists or was created, False on error.
    """
    try:
        Path(dir_path).mkdir(parents=True, exist_ok=True)
        return True
    except Exception as e:
        logger.error(f"Error creating directory {dir_path}: {e}")
        return False


def delete_file(file_path: Union[str, Path]) -> bool:
    """
    Delete a file if it exists.

    Args:
        file_path: Path to delete.

    Returns:
        True if deleted or didn't exist, False on error.
    """
    path = Path(file_path)

    if not path.exists():
        return True

    try:
        path.unlink()
        return True
    except Exception as e:
        logger.error(f"Error deleting {path}: {e}")
        return False

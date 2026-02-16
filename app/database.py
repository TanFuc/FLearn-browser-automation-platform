"""
Database Module for History Tracking.

Uses SQLite for persistent storage of invite history, account statistics,
and daily limits tracking.
"""

import json
import logging
import sqlite3
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from app.config import settings


class Database:
    """
    SQLite database manager for tracking invite history and statistics.

    Attributes:
        db_path: Path to the SQLite database file.
        conn: Database connection.
        logger: Logger instance.
    """

    def __init__(
        self,
        db_path: Path = None,
        logger: Optional[logging.Logger] = None
    ) -> None:
        """
        Initialize Database.

        Args:
            db_path: Path to database file.
            logger: Optional logger instance.
        """
        self.db_path = db_path or Path("fb_auto_invite.db")
        self.logger = logger or logging.getLogger(__name__)
        self.conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _init_db(self) -> None:
        """Initialize database and create tables if needed."""
        try:
            self.conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
            self.conn.row_factory = sqlite3.Row
            self._create_tables()
            self.logger.info(f"Database initialized: {self.db_path}")
        except Exception as e:
            self.logger.error(f"Database init error: {e}")

    def _create_tables(self) -> None:
        """Create required database tables."""
        cursor = self.conn.cursor()

        # Invite history table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS invite_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_address TEXT NOT NULL,
                group_url TEXT,
                invites_sent INTEGER DEFAULT 0,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                date TEXT NOT NULL
            )
        """)

        # Account statistics table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS account_stats (
                account_address TEXT PRIMARY KEY,
                total_invites INTEGER DEFAULT 0,
                total_sessions INTEGER DEFAULT 0,
                last_run DATETIME,
                checkpoint_count INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Daily summary table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS daily_summary (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                total_invites INTEGER DEFAULT 0,
                accounts_used INTEGER DEFAULT 0,
                errors INTEGER DEFAULT 0,
                UNIQUE(date)
            )
        """)

        # Warm-up tracking table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS warmup_status (
                account_address TEXT PRIMARY KEY,
                current_level INTEGER DEFAULT 1,
                invites_today INTEGER DEFAULT 0,
                last_increase DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        self.conn.commit()

    def record_invites(
        self,
        account_address: str,
        invites_sent: int,
        group_url: str = None
    ) -> None:
        """
        Record invite activity for an account.

        Args:
            account_address: Account identifier.
            invites_sent: Number of invites sent.
            group_url: Group URL where invites were sent.
        """
        today = date.today().isoformat()
        cursor = self.conn.cursor()

        # Insert into history
        cursor.execute("""
            INSERT INTO invite_history (account_address, group_url, invites_sent, date)
            VALUES (?, ?, ?, ?)
        """, (account_address, group_url, invites_sent, today))

        # Update account stats
        cursor.execute("""
            INSERT INTO account_stats (account_address, total_invites, total_sessions, last_run)
            VALUES (?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(account_address) DO UPDATE SET
                total_invites = total_invites + ?,
                total_sessions = total_sessions + 1,
                last_run = CURRENT_TIMESTAMP
        """, (account_address, invites_sent, invites_sent))

        # Update daily summary
        cursor.execute("""
            INSERT INTO daily_summary (date, total_invites, accounts_used)
            VALUES (?, ?, 1)
            ON CONFLICT(date) DO UPDATE SET
                total_invites = total_invites + ?,
                accounts_used = accounts_used + 1
        """, (today, invites_sent, invites_sent))

        # Update warmup status
        cursor.execute("""
            INSERT INTO warmup_status (account_address, invites_today)
            VALUES (?, ?)
            ON CONFLICT(account_address) DO UPDATE SET
                invites_today = invites_today + ?
        """, (account_address, invites_sent, invites_sent))

        self.conn.commit()

    def get_today_invites(self, account_address: str) -> int:
        """
        Get total invites sent today by an account.

        Args:
            account_address: Account identifier.

        Returns:
            Number of invites sent today.
        """
        today = date.today().isoformat()
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT COALESCE(SUM(invites_sent), 0) as total
            FROM invite_history
            WHERE account_address = ? AND date = ?
        """, (account_address, today))
        result = cursor.fetchone()
        return result["total"] if result else 0

    def get_daily_remaining(self, account_address: str, daily_limit: int) -> int:
        """
        Get remaining invites allowed for today.

        Args:
            account_address: Account identifier.
            daily_limit: Maximum daily invites allowed.

        Returns:
            Number of remaining invites.
        """
        used = self.get_today_invites(account_address)
        return max(0, daily_limit - used)

    def can_send_invites(self, account_address: str, daily_limit: int) -> bool:
        """
        Check if account can send more invites today.

        Args:
            account_address: Account identifier.
            daily_limit: Maximum daily invites allowed.

        Returns:
            True if account can send more invites.
        """
        return self.get_daily_remaining(account_address, daily_limit) > 0

    def get_warmup_level(self, account_address: str) -> int:
        """
        Get current warmup level for an account.

        Args:
            account_address: Account identifier.

        Returns:
            Warmup level (1-10, higher = more invites allowed).
        """
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT current_level FROM warmup_status
            WHERE account_address = ?
        """, (account_address,))
        result = cursor.fetchone()
        return result["current_level"] if result else 1

    def get_warmup_limit(self, account_address: str, base_limit: int) -> int:
        """
        Calculate invite limit based on warmup level.

        Args:
            account_address: Account identifier.
            base_limit: Base daily limit.

        Returns:
            Adjusted limit based on warmup level.
        """
        level = self.get_warmup_level(account_address)
        # Level 1: 10%, Level 2: 20%, ... Level 10: 100%
        multiplier = level / 10.0
        return max(5, int(base_limit * multiplier))

    def increase_warmup_level(self, account_address: str) -> int:
        """
        Increase warmup level for an account (max 10).

        Args:
            account_address: Account identifier.

        Returns:
            New warmup level.
        """
        cursor = self.conn.cursor()
        cursor.execute("""
            INSERT INTO warmup_status (account_address, current_level, last_increase)
            VALUES (?, 2, CURRENT_TIMESTAMP)
            ON CONFLICT(account_address) DO UPDATE SET
                current_level = MIN(current_level + 1, 10),
                last_increase = CURRENT_TIMESTAMP
        """, (account_address,))
        self.conn.commit()
        return self.get_warmup_level(account_address)

    def reset_daily_warmup(self) -> None:
        """Reset daily warmup counters (call at start of day)."""
        cursor = self.conn.cursor()
        cursor.execute("UPDATE warmup_status SET invites_today = 0")
        self.conn.commit()

    def record_checkpoint(self, account_address: str) -> None:
        """
        Record a checkpoint event for an account.

        Args:
            account_address: Account identifier.
        """
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE account_stats
            SET checkpoint_count = checkpoint_count + 1
            WHERE account_address = ?
        """, (account_address,))

        # Update daily summary errors
        today = date.today().isoformat()
        cursor.execute("""
            UPDATE daily_summary
            SET errors = errors + 1
            WHERE date = ?
        """, (today,))

        self.conn.commit()

    def get_account_stats(self, account_address: str) -> Optional[Dict]:
        """
        Get statistics for an account.

        Args:
            account_address: Account identifier.

        Returns:
            Dictionary with account statistics.
        """
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM account_stats WHERE account_address = ?
        """, (account_address,))
        result = cursor.fetchone()
        return dict(result) if result else None

    def get_weekly_stats(self) -> List[Dict]:
        """
        Get invite statistics for the last 7 days.

        Returns:
            List of daily statistics.
        """
        cursor = self.conn.cursor()
        week_ago = (date.today() - timedelta(days=7)).isoformat()
        cursor.execute("""
            SELECT date, total_invites, accounts_used, errors
            FROM daily_summary
            WHERE date >= ?
            ORDER BY date DESC
        """, (week_ago,))
        return [dict(row) for row in cursor.fetchall()]

    def get_total_stats(self) -> Dict:
        """
        Get overall statistics.

        Returns:
            Dictionary with total statistics.
        """
        cursor = self.conn.cursor()

        # Total invites
        cursor.execute("SELECT COALESCE(SUM(total_invites), 0) as total FROM account_stats")
        total_invites = cursor.fetchone()["total"]

        # Total accounts
        cursor.execute("SELECT COUNT(*) as count FROM account_stats")
        total_accounts = cursor.fetchone()["count"]

        # Today's invites
        today = date.today().isoformat()
        cursor.execute("""
            SELECT COALESCE(total_invites, 0) as today_invites
            FROM daily_summary WHERE date = ?
        """, (today,))
        result = cursor.fetchone()
        today_invites = result["today_invites"] if result else 0

        # Total checkpoints
        cursor.execute("SELECT COALESCE(SUM(checkpoint_count), 0) as total FROM account_stats")
        total_checkpoints = cursor.fetchone()["total"]

        return {
            "total_invites": total_invites,
            "total_accounts": total_accounts,
            "today_invites": today_invites,
            "total_checkpoints": total_checkpoints
        }

    def close(self) -> None:
        """Close database connection."""
        if self.conn:
            self.conn.close()
            self.conn = None


# Global database instance
db = Database()

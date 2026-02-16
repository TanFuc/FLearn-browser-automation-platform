"""
FB Auto Invite - Main Entry Point.

A scalable, maintainable Facebook group member auto-invite automation tool.
Refactored with clean architecture: separation of concerns, dependency injection,
and decoupled UI from business logic.

Usage:
    GUI Mode (default):
        python main.py

    CLI Mode (headless):
        python main.py --cli

    With custom config:
        python main.py --batch-size 3 --max-clicks 30
"""

import argparse
import logging
import sys
from pathlib import Path

# Add project root to path for imports
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from app.config import settings
from app.log_setup import log_manager, get_logger
from app.core.proxy import ProxyManager
from app.core.browser import BrowserManager
from app.services.account_manager import AccountManager
from app.services.bot_orchestrator import BotOrchestrator


def setup_logging(debug: bool = False) -> logging.Logger:
    """
    Setup application logging.

    Args:
        debug: Enable debug level logging.

    Returns:
        Main application logger.
    """
    if debug:
        logging.getLogger().setLevel(logging.DEBUG)

    return get_logger("main")


def run_gui() -> None:
    """Run the application in GUI mode."""
    from ui.main_window import MainWindow
    from ui.view_models import MainViewModel

    logger = get_logger("gui")
    logger.info("Starting GUI mode...")

    # Create view model and window
    view_model = MainViewModel()
    window = MainWindow(view_model)

    # Run the application
    window.run()


def run_cli(args: argparse.Namespace) -> int:
    """
    Run the application in CLI mode.

    Args:
        args: Command line arguments.

    Returns:
        Exit code (0 for success, 1 for error).
    """
    logger = get_logger("cli")
    logger.info("Starting CLI mode...")

    # Override settings from args
    if args.batch_size:
        settings.batch_size = args.batch_size
    if args.max_clicks:
        settings.max_clicks = args.max_clicks

    # Initialize services
    proxy_manager = ProxyManager(logger=logger)
    browser_manager = BrowserManager(logger=logger)
    account_manager = AccountManager(
        proxy_manager=proxy_manager,
        logger=logger
    )
    orchestrator = BotOrchestrator(
        account_manager=account_manager,
        browser_manager=browser_manager,
        logger=logger
    )

    # Setup callbacks
    def on_log(message: str) -> None:
        print(message)

    def on_status(status: str) -> None:
        print(f"[STATUS] {status}")

    orchestrator.set_callbacks(
        on_log=on_log,
        on_status_change=on_status
    )

    try:
        # Load accounts
        accounts = account_manager.load_accounts()
        if not accounts:
            logger.error("No accounts found!")
            return 1

        logger.info(f"Loaded {len(accounts)} accounts")

        # Build proxies if needed
        accounts_without_proxy = [a for a in accounts if not a.proxy]
        if accounts_without_proxy:
            logger.info(f"Assigning proxies to {len(accounts_without_proxy)} accounts...")
            account_manager.assign_proxies(accounts_without_proxy)

        # Run the bot
        logger.info("Starting bot run...")
        results = orchestrator.run(
            accounts=accounts,
            batch_size=settings.batch_size
        )

        # Print summary
        total_invites = sum(r.total_invites for r in results)
        total_successful = sum(r.successful for r in results)
        total_failed = sum(r.failed for r in results)

        logger.info("=" * 50)
        logger.info("RUN COMPLETE")
        logger.info(f"  Batches: {len(results)}")
        logger.info(f"  Successful: {total_successful}")
        logger.info(f"  Failed: {total_failed}")
        logger.info(f"  Total Invites: {total_invites}")
        logger.info("=" * 50)

        # Save final state
        account_manager.save_accounts()

        return 0

    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        orchestrator.shutdown()
        return 1

    except Exception as e:
        logger.error(f"Error: {e}", exc_info=True)
        orchestrator.shutdown()
        return 1

    finally:
        log_manager.shutdown()


def parse_args() -> argparse.Namespace:
    """
    Parse command line arguments.

    Returns:
        Parsed arguments namespace.
    """
    parser = argparse.ArgumentParser(
        description="FB Auto Invite - Facebook Group Member Auto-Invite Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    parser.add_argument(
        "--cli",
        action="store_true",
        help="Run in CLI mode (no GUI)"
    )

    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug logging"
    )

    parser.add_argument(
        "--batch-size",
        type=int,
        help=f"Accounts per batch (default: {settings.batch_size})"
    )

    parser.add_argument(
        "--max-clicks",
        type=int,
        help=f"Max friend requests per account (default: {settings.max_clicks})"
    )

    parser.add_argument(
        "--accounts-file",
        type=str,
        help=f"Path to accounts JSON file (default: {settings.account_status_file})"
    )

    return parser.parse_args()


def main() -> int:
    """
    Main entry point.

    Returns:
        Exit code.
    """
    args = parse_args()

    # Setup logging
    setup_logging(debug=args.debug)
    logger = get_logger("main")

    # Ensure required directories exist
    settings.ensure_directories()

    # Override accounts file if specified
    if args.accounts_file:
        settings.account_status_file = Path(args.accounts_file)

    logger.info("FB Auto Invite v2.0")
    logger.info(f"Profile directory: {settings.profile_dir}")
    logger.info(f"Batch size: {settings.batch_size}")
    logger.info(f"Max clicks: {settings.max_clicks}")

    # Run in appropriate mode
    if args.cli:
        return run_cli(args)
    else:
        try:
            run_gui()
            return 0
        except Exception as e:
            logger.error(f"GUI Error: {e}", exc_info=True)
            return 1


if __name__ == "__main__":
    sys.exit(main())

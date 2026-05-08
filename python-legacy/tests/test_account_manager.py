import unittest
from unittest.mock import MagicMock, patch
import sys
import os
from pathlib import Path

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.services.account_manager import AccountManager
from app.models import Account, AccountStatus

class TestAccountManager(unittest.TestCase):
    def setUp(self):
        self.mock_proxy_manager = MagicMock()
        self.mock_logger = MagicMock()
        
        # Patch database
        self.patcher_db = patch('app.database.db')
        self.mock_db = self.patcher_db.start()
        
        self.account_manager = AccountManager(
            proxy_manager=self.mock_proxy_manager,
            logger=self.mock_logger
        )

    def tearDown(self):
        self.patcher_db.stop()

    def test_add_account(self):
        account = Account(debugger_address="127.0.0.1:9222")
        self.account_manager.add_account(account, save=False)
        
        retrieved = self.account_manager.get_account("127.0.0.1:9222")
        self.assertEqual(retrieved, account)

    def test_remove_account(self):
        account = Account(debugger_address="127.0.0.1:9222")
        self.account_manager.add_account(account, save=False)
        
        result = self.account_manager.remove_account("127.0.0.1:9222", save=False)
        self.assertTrue(result)
        self.assertIsNone(self.account_manager.get_account("127.0.0.1:9222"))

    def test_get_statistics(self):
        acc1 = Account(debugger_address="127.0.0.1:9222", status=AccountStatus.OK)
        acc2 = Account(debugger_address="127.0.0.1:9223", status=AccountStatus.ERROR)
        
        self.account_manager.add_account(acc1, save=False)
        self.account_manager.add_account(acc2, save=False)
        
        stats = self.account_manager.get_statistics()
        self.assertEqual(stats[AccountStatus.OK.value], 1)
        self.assertEqual(stats[AccountStatus.ERROR.value], 1)

if __name__ == '__main__':
    unittest.main()

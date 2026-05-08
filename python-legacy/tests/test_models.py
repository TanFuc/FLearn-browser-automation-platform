import unittest
import sys
import os
from datetime import datetime

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.models import Account, AccountStatus

class TestAccountModel(unittest.TestCase):
    def test_account_serialization(self):
        acc = Account(
            debugger_address="127.0.0.1:9222",
            group_url="https://facebook.com/groups/test",
            status=AccountStatus.OK,
            invites_sent=5,
            last_run=datetime(2026, 4, 28, 22, 0, 0),
            fb_email="test@gmail.com",
            fb_password_enc="encrypted_pass"
        )
        
        acc_dict = acc.to_dict()
        
        # Verify serialization
        self.assertEqual(acc_dict["debugger_address"], "127.0.0.1:9222")
        self.assertEqual(acc_dict["group_url"], "https://facebook.com/groups/test")
        self.assertEqual(acc_dict["status"], AccountStatus.OK.value)
        self.assertEqual(acc_dict["invites_sent"], 5)
        self.assertEqual(acc_dict["fb_email"], "test@gmail.com")
        self.assertEqual(acc_dict["fb_password_enc"], "encrypted_pass")
        
        # Verify deserialization
        reconstructed = Account.from_dict(acc_dict)
        self.assertEqual(reconstructed.debugger_address, "127.0.0.1:9222")
        self.assertEqual(reconstructed.fb_email, "test@gmail.com")
        self.assertEqual(reconstructed.status, AccountStatus.OK)

if __name__ == '__main__':
    unittest.main()

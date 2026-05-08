import unittest
from unittest.mock import MagicMock, patch, PropertyMock
import sys
import os

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.core.automation import FacebookAutomation

class TestFacebookAutomation(unittest.TestCase):
    def setUp(self):
        self.mock_driver = MagicMock()
        self.mock_logger = MagicMock()
        self.automation = FacebookAutomation(
            driver=self.mock_driver,
            logger=self.mock_logger
        )

    def test_check_logged_out_visible_form(self):
        """Test that visible email and password fields indicate logged out state."""
        self.mock_driver.current_url = "https://www.facebook.com/"
        
        # Mock elements
        mock_email = MagicMock()
        mock_email.is_displayed.return_value = True
        mock_pass = MagicMock()
        mock_pass.is_displayed.return_value = True
        mock_btn = MagicMock()
        
        # Mock find_elements
        def find_elements_mock(by, selector):
            if "email" in selector:
                return [mock_email]
            if "pass" in selector:
                return [mock_pass]
            if "login" in selector or "submit" in selector:
                return [mock_btn]
            return []
            
        self.mock_driver.find_elements.side_effect = find_elements_mock

        result = self.automation.check_logged_out()
        self.assertTrue(result)

    def test_check_logged_out_url_pattern(self):
        """Test that login URL patterns indicate logged out state."""
        self.mock_driver.current_url = "https://www.facebook.com/login.php"
        self.mock_driver.find_elements.return_value = []

        result = self.automation.check_logged_out()
        self.assertTrue(result)

    def test_check_logged_out_logged_in(self):
        """Test that visible profile indicator indicates logged in state."""
        self.mock_driver.current_url = "https://www.facebook.com/"
        
        # Mock logged in indicator
        mock_profile = MagicMock()
        mock_profile.is_displayed.return_value = True
        
        def find_elements_mock(by, selector):
            if "Your profile" in selector:
                return [mock_profile]
            return []
            
        self.mock_driver.find_elements.side_effect = find_elements_mock

        result = self.automation.check_logged_out()
        self.assertFalse(result)

    @patch('time.sleep', return_value=None)
    def test_perform_login_success(self, mock_sleep):
        """Test successful login flow."""
        self.mock_driver.current_url = "https://www.facebook.com/"
        
        mock_email_field = MagicMock()
        mock_pass_field = MagicMock()
        mock_login_btn = MagicMock()
        
        # Mock find_elements to return fields initially, then empty after login
        def find_elements_mock(by, selector):
            current_url = getattr(self.mock_driver, 'current_url', '')
            if "home" in current_url:
                return []
            if "email" in selector:
                return [mock_email_field]
            if "pass" in selector:
                return [mock_pass_field]
            if "login" in selector or "submit" in selector:
                return [mock_login_btn]
            return []
            
        self.mock_driver.find_elements.side_effect = find_elements_mock
        
        with patch.object(self.automation, '_wait_for_element') as mock_wait:
            mock_wait.side_effect = [mock_email_field, mock_pass_field, mock_login_btn]
            
            # Mock current_url to simulate navigation to home after login
            type(self.mock_driver).current_url = PropertyMock(side_effect=[
                "https://www.facebook.com/", # step 1
                "https://www.facebook.com/", # check 1
                "https://www.facebook.com/home" # check success
            ])
            
            with patch.object(self.automation, 'check_disabled_account', return_value=False), \
                 patch.object(self.automation, 'check_checkpoint', return_value=False):
                 
                result = self.automation.perform_login("test@email.com", "password")
                self.assertEqual(result, "success")

if __name__ == '__main__':
    unittest.main()

"""
Credential encryption/decryption using Fernet symmetric encryption.

Key is stored in .encryption_key file (auto-generated if not exists).
This file should be in .gitignore - losing it means losing all encrypted passwords.
"""

import os
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken


# Key file location (in project root)
KEY_FILE = Path(".encryption_key")


def _get_or_create_key() -> bytes:
    """
    Load encryption key from file, or generate and save a new one.

    The key file should be in .gitignore to prevent accidental commits.

    Returns:
        Fernet encryption key as bytes.
    """
    if KEY_FILE.exists():
        return KEY_FILE.read_bytes()

    # Generate a new key
    key = Fernet.generate_key()

    # Save key with restricted permissions
    KEY_FILE.write_bytes(key)

    # Try to set file permissions (owner read/write only)
    try:
        if os.name != 'nt':  # Unix-like systems
            KEY_FILE.chmod(0o600)
    except Exception:
        pass  # Ignore permission errors on Windows

    return key


def encrypt_password(plaintext: str) -> str:
    """
    Encrypt a plaintext password using Fernet symmetric encryption.

    Args:
        plaintext: The password to encrypt.

    Returns:
        Base64-encoded encrypted ciphertext.

    Raises:
        ValueError: If plaintext is empty.
    """
    if not plaintext:
        raise ValueError("Cannot encrypt empty password")

    fernet = Fernet(_get_or_create_key())
    encrypted = fernet.encrypt(plaintext.encode('utf-8'))
    return encrypted.decode('utf-8')


def decrypt_password(ciphertext: str) -> str:
    """
    Decrypt an encrypted password.

    Args:
        ciphertext: Base64-encoded encrypted password.

    Returns:
        Decrypted plaintext password.

    Raises:
        ValueError: If ciphertext is empty or invalid.
        InvalidToken: If decryption fails (wrong key or corrupted data).
    """
    if not ciphertext:
        raise ValueError("Cannot decrypt empty ciphertext")

    fernet = Fernet(_get_or_create_key())
    decrypted = fernet.decrypt(ciphertext.encode('utf-8'))
    return decrypted.decode('utf-8')


def has_credentials(account) -> bool:
    """
    Check if an account has stored login credentials.

    Args:
        account: Account object to check.

    Returns:
        True if account has both email and encrypted password.
    """
    return bool(
        getattr(account, 'fb_email', None) and
        getattr(account, 'fb_password_enc', None)
    )


def verify_key_exists() -> bool:
    """
    Check if the encryption key file exists.

    Returns:
        True if key file exists.
    """
    return KEY_FILE.exists()


def get_key_path() -> Path:
    """
    Get the path to the encryption key file.

    Returns:
        Path to the key file.
    """
    return KEY_FILE.absolute()

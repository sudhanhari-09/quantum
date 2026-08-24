"""Encryption / decryption service (B19).

AES-256-GCM with a random 12-byte nonce, using the QKD-derived key from
KeyService. Called ONLY after SecurityEngine accepts the key; plaintext is
never stored or logged — it exists only as an in-memory argument.
"""

from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy.orm import Session

from app.models import Message
from app.services.key_service import KeyService
from app.services.security_engine import KeyRejected, SecurityEngine


class EncryptionService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.keys = KeyService(session)
        self.security = SecurityEngine(session)

    def encrypt_message(self, message: Message, plaintext: str) -> Message:
        """Gate: requires session in KEY_ACCEPTED state + stored key."""
        comm = message.session
        if comm is None:
            raise KeyRejected()
        # SecurityEngine gate — never encrypt without explicit acceptance.
        self.security.confirm_key_accepted(comm)
        if not self.keys.has_key(comm.id):
            raise KeyRejected()

        key = self.keys.load_key(comm.id)
        nonce = os.urandom(12)
        sealed = AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), None)
        message.encrypted_message = base64.b64encode(sealed).decode()
        message.nonce = base64.b64encode(nonce).decode()
        return message

    def decrypt_for_owner(self, message: Message) -> str:
        """Decrypt; caller enforces ownership + status DELIVERED/READ."""
        if message.status not in ("DELIVERED", "READ"):
            raise PermissionError("Message is not readable.")
        comm = message.session
        key = self.keys.load_key(comm.id)
        sealed = base64.b64decode(message.encrypted_message)
        nonce = base64.b64decode(message.nonce)
        return AESGCM(key).decrypt(nonce, sealed, None).decode("utf-8")

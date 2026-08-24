"""Key management (B18): HKDF derivation + AES-GCM encryption at rest.

QKD sifted bits -> HKDF-SHA256(info=communication_id) -> 32-byte key,
stored encrypted under QSC_MASTER_KEY in secret_keys [REC]. Key material is
NEVER returned by any API; rejected path persists no row.
"""

from __future__ import annotations

import base64
import os
from typing import Optional

import bcrypt  # noqa: F401 (kept for constant-time helpers if needed)
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import SecretKey


class MasterKeyNotConfigured(RuntimeError):
    pass


def _master_key() -> bytes:
    try:
        return settings.master_key_bytes
    except ValueError as exc:
        raise MasterKeyNotConfigured(str(exc)) from exc


def derive_key(sifted_key_bits: str, communication_id: int) -> bytes:
    """HKDF-SHA256 over sifted bitstring + communication id binding -> 32 bytes."""
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=f"qsc-comm-{communication_id}".encode(),
    )
    return hkdf.derive(sifted_key_bits.encode("ascii"))


def encrypt_at_rest(key: bytes) -> str:
    """AES-256-GCM under the server master key; returns base64(nonce+ct+tag)."""
    master = _master_key()
    nonce = os.urandom(12)
    sealed = AESGCM(master).encrypt(nonce, key, b"qsc-secret-key")
    return base64.b64encode(nonce + sealed).decode()


def decrypt_at_rest(key_enc: str) -> bytes:
    raw = base64.b64decode(key_enc)
    nonce, sealed = raw[:12], raw[12:]
    return AESGCM(_master_key()).decrypt(nonce, sealed, b"qsc-secret-key")


class KeyError_(Exception):
    pass


class KeyService:
    def __init__(self, session: Session) -> None:
        self.session = session

    def store_accepted_key(self, communication_id: int, qkd_session_id: int,
                           sifted_key_bits: str) -> SecretKey:
        derived = derive_key(sifted_key_bits, communication_id)
        row = SecretKey(
            communication_id=communication_id,
            qkd_session_id=qkd_session_id,
            key_status="ACCEPTED",
            key_enc=encrypt_at_rest(derived),
        )
        self.session.add(row)
        self.session.flush()
        return row

    def load_key(self, communication_id: int) -> bytes:
        """Decrypts the stored key in-process only. Raises if absent."""
        row = (
            self.session.query(SecretKey)
            .filter(SecretKey.communication_id == communication_id)
            .order_by(SecretKey.id.desc())
            .first()
        )
        if row is None:
            raise KeyError_("No accepted key exists for this communication.")
        return decrypt_at_rest(row.key_enc)

    def has_key(self, communication_id: int) -> bool:
        return (
            self.session.query(SecretKey)
            .filter(SecretKey.communication_id == communication_id)
            .count()
            > 0
        )

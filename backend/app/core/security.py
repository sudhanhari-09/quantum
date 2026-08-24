"""Cryptographic helpers: bcrypt password hashing, JWT issue/verify, token hashes."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from app.core.config import settings
from app.core.exceptions import AppError


class TokenInvalid(AppError):
    status_code = 401
    code = "TOKEN_INVALID"
    message = "Token is invalid or expired."


# ---- passwords ---------------------------------------------------------------

BCRYPT_ROUNDS = 12


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def password_policy_ok(email: str, password: str) -> bool:
    """min 8 chars; must not contain the email local part [REC]."""
    if len(password or "") < 8:
        return False
    local = (email or "").split("@")[0].lower()
    if local and local in password.lower():
        return False
    return True


# ---- JWT ---------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(user_id: int, role: str, jti: str | None = None) -> tuple[str, int]:
    expires_in = settings.access_token_expire_minutes * 60
    now = _now()
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "role": role,
        "type": "access",
        "iat": now,
        "exp": now + timedelta(seconds=expires_in),
        "jti": jti or uuid.uuid4().hex,
    }
    token = jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
    return token, expires_in


def create_refresh_token() -> tuple[str, str]:
    """Return (raw_refresh_token, sha256_hash_to_store)."""
    raw = secrets.token_urlsafe(48)
    return raw, hash_refresh_token(raw)


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "sub", "type"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenInvalid("Access token has expired.") from exc
    except jwt.PyJWTError as exc:
        raise TokenInvalid() from exc
    if payload.get("type") != "access":
        raise TokenInvalid()
    return payload


def timing_safe_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())

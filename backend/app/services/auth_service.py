"""Authentication service (B6): register, login, refresh rotation, logout."""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone  # noqa: F401 (timezone used by callers' typing)

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_refresh_token,
    password_policy_ok,
    verify_password,
)
from app.models import Role, User
from app.repositories.user_repository import RefreshTokenRepository, UserRepository
from app.services.audit_service import record as audit
from app.services.qsc_id_service import generate_qsc_id

MAX_QSC_ID_ATTEMPTS = 5


def _as_utc(dt: datetime) -> datetime:
    """SQLite returns naive datetimes; treat them as UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


class EmailTaken(AppError):
    status_code = 409
    code = "EMAIL_TAKEN"
    message = "An account with this email already exists."


class InvalidCredentials(AppError):
    status_code = 401
    code = "INVALID_CREDENTIALS"
    message = "Invalid email or password."  # identical for unknown email/password (no enumeration)


class UserDisabled(AppError):
    status_code = 403
    code = "USER_DISABLED"
    message = "This account has been disabled."


class TokenReused(AppError):
    status_code = 401
    code = "TOKEN_REUSED"
    message = "Refresh token reuse detected; session revoked."


class AuthService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.users = UserRepository(session)
        self.refresh_tokens = RefreshTokenRepository(session)

    # ---- register ------------------------------------------------------------
    def register(self, name: str, email: str, password: str) -> User:
        if not password_policy_ok(email, password):
            raise AppError(
                "Password does not meet policy.",
                code="WEAK_PASSWORD",
                status_code=422,
            )
        normalized = email.strip().lower()
        if self.users.email_exists(normalized):
            audit(self.session, "register.failed", f"registration failed for {normalized}")
            raise EmailTaken()

        user = User(
            unique_user_id=self._generate_unique_qsc_id(),
            name=name.strip(),
            email=normalized,
            password_hash=hash_password(password),
            role=Role.USER,
            is_active=True,
        )
        self.users.add(user)
        self.session.flush()
        audit(
            self.session,
            "register",
            f"user registered with QSC ID {user.unique_user_id}",
            user_id=user.id,
        )
        return user

    def _generate_unique_qsc_id(self) -> str:
        for _ in range(MAX_QSC_ID_ATTEMPTS):
            candidate = generate_qsc_id()
            if self.users.get_by_qsc_id(candidate) is None:
                return candidate
        raise AppError("Could not allocate a unique QSC ID.", code="QSC_ID_EXHAUSTED", status_code=500)

    # ---- attacker account creation (admin only, B30) ---------------------------
    def register_attacker(self, name: str, email: str, password: str) -> User:
        if not password_policy_ok(email, password):
            raise AppError(
                "Password does not meet policy.",
                code="WEAK_PASSWORD",
                status_code=422,
            )
        normalized = email.strip().lower()
        if self.users.email_exists(normalized):
            audit(self.session, "register.failed", f"registration failed for {normalized}")
            raise EmailTaken()

        user = User(
            unique_user_id=self._generate_unique_qsc_id(),
            name=name.strip(),
            email=normalized,
            password_hash=hash_password(password),
            role=Role.ATTACKER,
            is_active=True,
        )
        self.users.add(user)
        self.session.flush()
        return user

    # ---- login -----------------------------------------------------------------
    def login(self, email: str, password: str) -> dict:
        user = self.users.get_by_email(email)
        if user is None or not verify_password(password, user.password_hash):
            audit(self.session, "login.failed", f"failed login attempt for {email.strip().lower()}")
            raise InvalidCredentials()
        if not user.is_active:
            raise UserDisabled()

        access_token, expires_in = create_access_token(user.id, user.role)
        raw_refresh, refresh_hash = create_refresh_token()
        expires_at = datetime.now(timezone.utc) + timedelta(days=self._refresh_days())
        self.refresh_tokens.add(user.id, refresh_hash, expires_at)
        audit(self.session, "login", "user logged in", user_id=user.id)
        return {
            "access_token": access_token,
            "refresh_token": raw_refresh,
            "token_type": "bearer",
            "expires_in": expires_in,
            "user": user,
        }

    def _refresh_days(self) -> int:
        from app.core.config import settings

        return settings.refresh_token_expire_days

    # ---- refresh ---------------------------------------------------------------
    def refresh(self, raw_refresh_token: str) -> dict:
        token_hash = hash_refresh_token(raw_refresh_token)
        stored = self.refresh_tokens.get_any(token_hash)

        if stored is not None and stored.revoked_at is not None:
            # Reuse of a rotated/revoked token: revoke the whole family.
            self.refresh_tokens.revoke_all_for_user(stored.user_id)
            audit(
                self.session,
                "security.refresh_reuse_detected",
                f"refresh reuse detected for user {stored.user_id}; family revoked",
                user_id=stored.user_id,
            )
            raise TokenReused()

        if stored is None or _as_utc(stored.expires_at) <= datetime.now(timezone.utc):
            raise AppError("Refresh token is invalid or expired.", code="TOKEN_INVALID", status_code=401)
        user = self.users.get_by_id(stored.user_id)
        if user is None or not user.is_active:
            self.refresh_tokens.revoke(stored)
            raise UserDisabled()

        self.refresh_tokens.revoke(stored)  # rotate
        new_raw, new_hash = create_refresh_token()
        expires_at = datetime.now(timezone.utc) + timedelta(days=self._refresh_days())
        self.refresh_tokens.add(user.id, new_hash, expires_at)
        access_token, expires_in = create_access_token(user.id, user.role)
        audit(self.session, "auth.refresh", "access token refreshed", user_id=user.id)
        return {
            "access_token": access_token,
            "refresh_token": new_raw,
            "expires_in": expires_in,
            "user": user,
        }

    # ---- logout ---------------------------------------------------------------
    def logout(self, user_id: int, raw_refresh_token: str | None) -> None:
        if raw_refresh_token:
            row = self.refresh_tokens.get_valid(hash_refresh_token(raw_refresh_token))
            if row is not None and row.user_id == user_id:
                self.refresh_tokens.revoke(row)
        else:
            self.refresh_tokens.revoke_all_for_user(user_id)
        audit(self.session, "logout", "user logged out", user_id=user_id)

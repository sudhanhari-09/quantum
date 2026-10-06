"""User + refresh-token repositories (ORM access stays inside this layer)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, func, update
from sqlalchemy.orm import Session

from app.models import RefreshToken, User


def as_utc(dt: datetime) -> datetime:
    """SQLite returns naive datetimes; treat them as UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


class UserRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_by_id(self, user_id: int) -> Optional[User]:
        return self.session.get(User, user_id)

    def get_by_email(self, email: str) -> Optional[User]:
        return self.session.scalar(select(User).where(User.email == email.strip().lower()))

    def get_by_qsc_id(self, qsc_id: str) -> Optional[User]:
        return self.session.scalar(select(User).where(User.unique_user_id == qsc_id.upper()))

    def email_exists(self, email: str) -> bool:
        return (
            self.session.scalar(
                select(func.count()).select_from(User).where(User.email == email.strip().lower())
            )
            or 0
        ) > 0

    def add(self, user: User) -> User:
        self.session.add(user)
        self.session.flush()
        return user

    def search_paginated(
        self,
        query: str | None,
        page: int,
        limit: int,
    ) -> tuple[list[User], int]:
        stmt = select(User).order_by(User.id.desc())
        if query:
            like = f"%{query.lower()}%"
            stmt = stmt.where(
                (func.lower(User.name).like(like))
                | (User.email.like(like))
                | (User.unique_user_id.like(f"%{query.upper()}%"))
            )
        total = self.session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        rows = self.session.scalars(
            stmt.limit(limit).offset((page - 1) * limit)
        ).all()
        return list(rows), int(total)


class RefreshTokenRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, user_id: int, token_hash: str, expires_at: datetime) -> RefreshToken:
        row = RefreshToken(user_id=user_id, token_hash=token_hash, expires_at=expires_at)
        self.session.add(row)
        self.session.flush()
        return row

    def get_any(self, token_hash: str) -> Optional[RefreshToken]:
        return self.session.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))

    def get_valid(self, token_hash: str) -> Optional[RefreshToken]:
        row = self.get_any(token_hash)
        if row is None or row.revoked_at is not None:
            return None
        if as_utc(row.expires_at) <= datetime.now(timezone.utc):
            return None
        return row

    def revoke(self, row: RefreshToken) -> None:
        row.revoked_at = datetime.now(timezone.utc)

    def revoke_if_active(self, token_hash: str) -> Optional[RefreshToken]:
        """Atomically revoke a token and report whether THIS call won.

        Rotation must be a compare-and-swap: a plain read-then-write lets two
        simultaneous refreshes both observe ``revoked_at IS NULL`` and both mint
        a successor from one token. The ``UPDATE ... WHERE revoked_at IS NULL``
        guarantees exactly one winner; every loser gets ``None`` and is treated
        as reuse, so a single refresh token can never produce two live pairs.
        """
        row = self.get_any(token_hash)
        if row is None:
            return None
        result = self.session.execute(
            update(RefreshToken)
            .where(RefreshToken.id == row.id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=datetime.now(timezone.utc))
        )
        if result.rowcount != 1:
            return None
        self.session.refresh(row)
        return row

    def revoke_all_for_user(self, user_id: int) -> None:
        now = datetime.now(timezone.utc)
        for row in self.session.scalars(
            select(RefreshToken).where(
                RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None)
            )
        ):
            row.revoked_at = now

"""User service (B8/B10)."""

from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.models import User
from app.repositories.user_repository import UserRepository
from app.services.qsc_id_service import QSC_ID_REGEX


class UserNotFound(Exception):
    pass


class UserService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.users = UserRepository(session)

    def update_name(self, user_id: int, name: str) -> User:
        if not (2 <= len(name or "") <= 80):
            raise AppError(
                "Name must be 2..80 characters.", code="VALIDATION_ERROR", status_code=422
            )
        user = self.users.get_by_id(user_id)
        if user is None:
            raise AppError("User not found.", code="USER_NOT_FOUND", status_code=404)
        user.name = name.strip()
        self.session.flush()
        return user

    def search_by_qsc_id(self, qsc_id: str, requester_id: int | None) -> tuple[User, bool]:
        normalized = (qsc_id or "").strip().upper()
        if not re.match(QSC_ID_REGEX, normalized):
            raise AppError(
                "QSC ID must match QSC-[A-Z0-9]{10}.",
                code="INVALID_QSC_FORMAT",
                status_code=422,
            )
        found = self.users.get_by_qsc_id(normalized)
        if found is None:
            raise UserNotFound(normalized)
        return found, requester_id is not None and found.id == requester_id

    def get_public(self, user: User) -> dict:
        return {"id": user.id, "name": user.name, "unique_user_id": user.unique_user_id}

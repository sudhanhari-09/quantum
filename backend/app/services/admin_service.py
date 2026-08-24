"""Admin service (B8/B30): user lifecycle management with audit."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.models import Role, User
from app.repositories.user_repository import UserRepository
from app.services.audit_service import record as audit


class AdminService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.users = UserRepository(session)

    def set_user_active(self, user_id: int, is_active: bool, actor: User) -> User:
        user = self.users.get_by_id(user_id)
        if user is None:
            raise AppError("User not found.", code="USER_NOT_FOUND", status_code=404)
        if user.role == Role.ADMIN and not is_active:
            raise AppError(
                "Admins cannot be disabled.",
                code="ADMIN_CANNOT_DISABLE_SELF",
                status_code=409,
            )
        user.is_active = is_active
        self.session.flush()
        audit(
            self.session,
            "admin.user_status_changed",
            f"user {user.unique_user_id} set {'active' if is_active else 'disabled'}",
            user_id=actor.id,
        )
        return user

"""Authorization dependencies + visibility matrix (B7).

Roles enforced on every route via require_roles; resource ownership is
checked separately by the owning services. Eve-scoped responses are built
from dedicated schemas that exclude sensitive fields by construction.
"""

from __future__ import annotations

from typing import Callable

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.exceptions import AppError, ForbiddenError, UnauthorizedError
from app.core.security import decode_access_token
from app.db.session import get_session_factory
from app.models import Role, User


class RoleForbidden(AppError):
    status_code = 403
    code = "ROLE_FORBIDDEN"
    message = "Your role cannot access this resource."


def get_db_session() -> Session:
    factory = get_session_factory()
    session = factory()
    try:
        yield session
    except AppError:
        # Business errors still persist their DB side effects (security
        # revocations, failed-login audits) before surfacing the envelope.
        try:
            session.commit()
        except Exception:
            session.rollback()
        raise
    except Exception:
        session.rollback()
        raise
    else:
        session.commit()
    finally:
        session.close()


SessionDep = Depends(get_db_session)


def get_current_user(request: Request, session: Session = SessionDep) -> User:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise AppError("Missing bearer token.", code="TOKEN_REQUIRED", status_code=401)
    token = auth_header[len("Bearer ") :].strip()
    payload = decode_access_token(token)
    user_id = int(payload["sub"])
    user = session.get(User, user_id)
    if user is None:
        raise UnauthorizedError()
    if not user.is_active:
        raise ForbiddenError("Account disabled.", details={"code_override": "USER_DISABLED"})
    request.state.user = user
    return user


CurrentUser = Depends(get_current_user)


def require_roles(*roles: str) -> Callable[[User], User]:
    """Returns a dependency function enforcing the role allow-list (fail-closed)."""

    allowed = set(roles) or {Role.USER}

    def dependency(user: User = CurrentUser) -> User:
        if user.role not in allowed:
            raise RoleForbidden(f"Role {user.role} cannot access this resource.")
        return user

    return dependency


# ---- visibility matrix (Section 4) ------------------------------------------

VISIBILITY_MATRIX: dict[str, dict[str, set[str]]] = {
    # resource -> role -> visible field sets (enforced by response schemas too)
    "user_public": {
        "USER": {"id", "name", "unique_user_id"},
        "ATTACKER": {"id", "name", "unique_user_id"},
        "ADMIN": {"id", "name", "unique_user_id", "email", "is_active"},
    },
    "message": {
        "USER": {"id", "sender", "receiver", "content", "protocol", "qber",
                 "key_status", "status", "attack_detected", "created_at", "read_at"},
        "ATTACKER": set(),  # eve never sees message resources
        "ADMIN": {"id", "sender", "receiver", "protocol", "qber", "key_status",
                  "status", "attack_detected", "created_at", "read_at"},  # no content
    },
}


def visible_fields(resource: str, role: str) -> set[str]:
    return VISIBILITY_MATRIX.get(resource, {}).get(role, set())

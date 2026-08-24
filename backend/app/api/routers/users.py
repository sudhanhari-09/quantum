"""Users router (B8/B10): profile + QSC-ID search."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.dependencies import SessionDep, get_current_user, require_roles
from app.core.exceptions import AppError
from app.core.ratelimit import rate_limit
from app.models import Role, User
from app.schemas.user import SearchUserResponse, UserPrivate
from app.services.user_service import UserService, UserNotFound

router = APIRouter(prefix="/users", tags=["users"])


class UpdateProfileRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)


@router.get("/me", response_model=UserPrivate)
def get_profile(user: User = Depends(get_current_user)):
    return UserPrivate.model_validate(user)


@router.patch("/me", response_model=UserPrivate)
def update_profile(
    body: UpdateProfileRequest,
    session: Session = SessionDep,
    user: User = Depends(get_current_user),
):
    updated = UserService(session).update_name(user.id, body.name.strip())
    return UserPrivate.model_validate(updated)


@router.get("/search", response_model=SearchUserResponse)
@rate_limit(scope="user_search")
def search_by_qsc_id(
    request: Request,
    qsc_id: str = Query(min_length=1, max_length=20),
    session: Session = SessionDep,
    user: User = Depends(require_roles(Role.USER)),
):
    try:
        found, is_self = UserService(session).search_by_qsc_id(qsc_id, requester_id=user.id)
    except UserNotFound as exc:
        raise AppError(
            "No user with that QSC ID.", code="USER_NOT_FOUND", status_code=404
        ) from exc
    return {
        "user": {
            "id": found.id,
            "name": found.name,
            "unique_user_id": found.unique_user_id,
            "role": Role.USER if found.role != Role.ADMIN else Role.ADMIN,
        },
        "is_self": is_self,
    }

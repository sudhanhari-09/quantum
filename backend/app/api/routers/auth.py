"""Auth router: register / login / refresh / logout / me (B6)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.core.dependencies import SessionDep, get_current_user
from app.core.ratelimit import rate_limit
from app.models import User
from app.schemas.user import (
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    RegisterRequest,
    TokenPairResponse,
    UserPrivate,
    UserPublic,
    UserResponse,
)
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
@rate_limit(scope="auth")
def register(request: Request, body: RegisterRequest, session: Session = SessionDep):
    user = AuthService(session).register(body.name, body.email, body.password)
    return {"user": UserPrivate.model_validate(user)}


@router.post("/login", response_model=TokenPairResponse)
@rate_limit(scope="auth")
def login(request: Request, body: LoginRequest, session: Session = SessionDep):
    result = AuthService(session).login(body.email, body.password)
    result["user"] = UserPublic.model_validate(result["user"])
    return result


@router.post("/refresh")
@rate_limit(scope="auth")
def refresh(request: Request, body: RefreshRequest, session: Session = SessionDep):
    result = AuthService(session).refresh(body.refresh_token)
    return {
        "access_token": result["access_token"],
        "refresh_token": result["refresh_token"],
        "expires_in": result["expires_in"],
    }


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    body: LogoutRequest | None = None,
    session: Session = SessionDep,
    user: User = Depends(get_current_user),
):
    AuthService(session).logout(user.id, body.refresh_token if body else None)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(get_current_user)):
    return {"user": UserPrivate.model_validate(user)}

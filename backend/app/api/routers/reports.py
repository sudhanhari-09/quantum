"""Reports router (B27 list endpoint)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.dependencies import SessionDep, get_current_user
from app.models import User
from app.services.reporting_service import ReportingService

router = APIRouter(prefix="/reports", tags=["reports"])
# F18 contract alias: the reports list is also served at /security-reports.
alias_router = APIRouter(tags=["reports"])


@router.get("/security")
def security_reports_list(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    session: Session = SessionDep,
    user: User = Depends(get_current_user),
):
    return _list_impl(session, user, page, limit)


@alias_router.get("/security-reports")
def security_reports_alias(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    session: Session = SessionDep,
    user: User = Depends(get_current_user),
):
    return _list_impl(session, user, page, limit)


def _list_impl(session: Session, user: User, page: int, limit: int):
    items, total = ReportingService(session).list_for_user(user.id, page, limit)
    return {
        "items": [
            {
                "message_id": r.message_id,
                "protocol": r.protocol,
                "qber": r.qber,
                "attack_detected": r.attack_detected,
                "key_status": r.key_status,
                "encryption_status": r.encryption_status,
                "delivery_status": r.delivery_status,
                "created_at": r.created_at.isoformat(),
            }
            for r in items
        ],
        "total": total,
        "page": page,
        "limit": limit,
    }

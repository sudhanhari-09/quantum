"""Admin router (B30/B31/B32): users, attackers, config, stats, audit logs."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select, text as sql_text
from sqlalchemy.orm import Session

from app.core.dependencies import SessionDep, get_current_user, require_roles
from app.core.exceptions import AppError
from app.models import (
    AiRecommendation,
    Attack,
    AuditLog,
    CommunicationSession,
    Message,
    ProtocolConfig,
    QkdSession,
    Role,
    User,
)
from app.db.base import utcnow
from app.repositories.user_repository import UserRepository
from app.services.admin_service import AdminService
from app.services.audit_service import record as audit
from app.services.auth_service import AuthService
from app.services.state_machine import ATTACK_WINDOW_STATES

router = APIRouter(prefix="/admin", tags=["admin"])


def _audit_row(session: Session, a: AuditLog) -> dict:
    u = session.get(User, a.user_id) if a.user_id else None
    return {
        "id": a.id,
        "user_id": a.user_id,
        "user_name": u.name if u else None,
        "user_role": u.role if u else None,
        "action": a.action,
        "description": a.description,
        "created_at": a.created_at.isoformat(),
    }


class UpdateUserActiveRequest(BaseModel):
    is_active: bool


@router.get("/users")
def list_users(
    search: str | None = Query(default=None, max_length=80),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    session: Session = SessionDep,
    admin: User = Depends(require_roles(Role.ADMIN)),
):
    users, total = UserRepository(session).search_paginated(search, page, limit)
    return {
        "items": [
            {
                "id": u.id,
                "name": u.name,
                "email": u.email,  # admin may see email, never password_hash
                "unique_user_id": u.unique_user_id,
                "role": u.role,
                "is_active": u.is_active,
                "created_at": u.created_at.isoformat(),
            }
            for u in users
        ],
        "total": total,
        "page": page,
        "limit": limit,
    }


@router.patch("/users/{user_id}")
def update_user_active(
    user_id: int,
    body: UpdateUserActiveRequest,
    session: Session = SessionDep,
    admin: User = Depends(require_roles(Role.ADMIN)),
):
    if user_id == admin.id and not body.is_active:
        raise AppError(
            "Admins cannot disable themselves.",
            code="ADMIN_CANNOT_DISABLE_SELF",
            status_code=409,
        )
    updated = AdminService(session).set_user_active(user_id, body.is_active, actor=admin)
    return {
        "id": updated.id,
        "name": updated.name,
        "email": updated.email,
        "role": updated.role,
        "is_active": updated.is_active,
    }


# ---- B30: attacker account management ----------------------------------------


class CreateAttackerRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=8, max_length=128)


@router.post("/attackers", status_code=201)
def create_attacker(
    body: CreateAttackerRequest,
    session: Session = SessionDep,
    admin: User = Depends(require_roles(Role.ADMIN)),
):
    user = AuthService(session).register_attacker(body.name, body.email, body.password)
    audit(session, "admin.attacker_created",
          f"attacker account created for {body.email.lower()}", user_id=admin.id)
    return {
        "user": {"id": user.id, "name": user.name, "email": user.email,
                 "role": user.role, "unique_user_id": user.unique_user_id}
    }


@router.get("/attackers")
def list_attackers(
    session: Session = SessionDep,
    admin: User = Depends(require_roles(Role.ADMIN)),
):
    rows = session.scalars(
        select(User).where(User.role == Role.ATTACKER).order_by(User.id)
    ).all()
    return {"attackers": [
        {"id": u.id, "name": u.name, "email": u.email, "is_active": u.is_active}
        for u in rows
    ]}


@router.patch("/attackers/{attacker_id}")
def update_attacker(
    attacker_id: int,
    body: UpdateUserActiveRequest,
    session: Session = SessionDep,
    admin: User = Depends(require_roles(Role.ADMIN)),
):
    svc = AdminService(session)
    row = UserRepository(session).get_by_id(attacker_id)
    if row is None or row.role != Role.ATTACKER:
        raise AppError("Attacker not found.", code="USER_NOT_FOUND", status_code=404)
    updated = svc.set_user_active(attacker_id, body.is_active, actor=admin)
    return {"id": updated.id, "name": updated.name, "is_active": updated.is_active}


# ---- B30: dashboard summary + platform communications -------------------------


@router.get("/dashboard/summary")
def dashboard_summary(
    session: Session = SessionDep,
    admin: User = Depends(require_roles(Role.ADMIN)),
):
    total_users = session.scalar(select(func.count()).select_from(User)) or 0
    active_comms = (
        session.scalar(
            select(func.count())
            .select_from(CommunicationSession)
            .where(CommunicationSession.session_status.not_in(["READ", "BLOCKED", "FAILED"]))
        )
        or 0
    )
    delivered = (
        session.scalar(
            select(func.count()).select_from(Message).where(
                Message.status.in_(["DELIVERED", "READ"])
            )
        )
        or 0
    )
    blocked = (
        session.scalar(select(func.count()).select_from(Message).where(Message.status == "BLOCKED"))
        or 0
    )
    attacks_total = session.scalar(select(func.count()).select_from(Attack)) or 0
    attacks_detected = (
        session.scalar(
            select(func.count()).select_from(Attack).where(Attack.detection_status == "DETECTED")
        )
        or 0
    )
    avg_qber = session.scalar(select(func.avg(QkdSession.qber)))

    # communications per day (last 7 days)
    week_ago = (utcnow() - timedelta(days=6)).replace(tzinfo=None)
    per_day_rows = session.execute(
        sql_text(
            "SELECT DATE(created_at) AS d, COUNT(*) AS c FROM communication_sessions "
            "WHERE created_at >= :since GROUP BY DATE(created_at) ORDER BY d"
        ),
        {"since": week_ago},
    ).fetchall()

    detection_rate = round(attacks_detected / attacks_total, 4) if attacks_total else 0.0

    # security outcomes pie + protocol usage bars + recent audit feed
    delivered_n = delivered
    outcomes = [
        {"outcome": "DELIVERED", "count": int(delivered_n)},
        {"outcome": "BLOCKED", "count": int(blocked)},
    ]
    usage_rows = session.execute(
        sql_text(
            "SELECT COALESCE(protocol, 'UNKNOWN') AS p, COUNT(*) AS c "
            "FROM communication_sessions GROUP BY COALESCE(protocol, 'UNKNOWN') "
            "ORDER BY c DESC"
        )
    ).fetchall()
    recent_audit_rows = session.scalars(
        select(AuditLog).order_by(AuditLog.id.desc()).limit(8)
    ).all()

    return {
        "total_users": int(total_users),
        "active_communications": int(active_comms),
        "messages_delivered": int(delivered),
        "messages_blocked": int(blocked),
        "attacks_total": int(attacks_total),
        "attacks_detected": int(attacks_detected),
        "attack_detection_rate": detection_rate,
        "average_qber": round(float(avg_qber), 6) if avg_qber is not None else None,
        "communications_per_day": [{"date": str(r[0]), "count": int(r[1])} for r in per_day_rows],
        "security_outcomes": outcomes,
        "protocol_usage": [{"protocol": r[0], "sessions": int(r[1])} for r in usage_rows],
        "recent_audit": [_audit_row(session, a) for a in recent_audit_rows],
    }


@router.get("/communications")
def platform_communications(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    session: Session = SessionDep,
    admin: User = Depends(require_roles(Role.ADMIN)),
):
    from app.api.routers.communications import _detail

    base = select(CommunicationSession).order_by(CommunicationSession.created_at.desc())
    total = session.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = session.scalars(base.limit(limit).offset((page - 1) * limit)).all()
    # NOTE: admin detail omits message content by construction (_detail has none).
    return {"items": [_detail(session, c) for c in rows],
            "total": int(total), "page": page, "limit": limit}


# ---- B30/B28: security events feed ---------------------------------------------


@router.get("/security-events")
def security_events(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    detected_only: bool | None = Query(default=None),
    session: Session = SessionDep,
    admin: User = Depends(require_roles(Role.ADMIN)),
):
    from app.models import SecurityReport

    base = (
        select(SecurityReport, Message, CommunicationSession)
        .join(Message, SecurityReport.message_id == Message.id)
        .join(CommunicationSession, Message.communication_id == CommunicationSession.id)
        .order_by(SecurityReport.created_at.desc())
    )
    if detected_only is not None:
        base = base.where(SecurityReport.attack_detected == detected_only)

    total = session.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = session.execute(base.limit(limit).offset((page - 1) * limit)).all()
    items = []
    for report, msg, comm in rows:
        attack = (
            session.query(Attack)
            .filter(Attack.communication_id == comm.id)
            .order_by(Attack.id.desc())
            .first()
        )
        verdict = "DETECTED" if report.attack_detected else (
            "CLEAN" if report.delivery_status == "DELIVERED" else report.key_status
        )
        items.append({
            "communication_id": comm.id,
            "message_id": msg.id,
            "protocol": report.protocol,
            "qber": report.qber,
            "threshold": _latest_threshold(session, comm.id),
            "key_status": report.key_status,
            "attack_detected": report.attack_detected,
            "verdict": verdict,
            "detection_status": attack.detection_status if attack else None,
            "delivery_status": report.delivery_status,
            "created_at": report.created_at.isoformat(),
        })
    return {"items": items, "total": int(total), "page": page, "limit": limit}


def _latest_threshold(session: Session, comm_id: int):
    row = (
        session.query(QkdSession)
        .filter(QkdSession.communication_id == comm_id)
        .order_by(QkdSession.id.desc())
        .first()
    )
    return row.threshold if row else None


# ---- B31: protocol analytics -----------------------------------------------------


@router.get("/protocol-analytics")
def protocol_analytics(
    session: Session = SessionDep,
    admin: User = Depends(require_roles(Role.ADMIN)),
):
    protocols = session.execute(
        sql_text("SELECT protocol FROM protocol_configs ORDER BY protocol")
    ).fetchall()

    out = []
    for (name,) in protocols:
        sessions_count = (
            session.scalar(
                select(func.count())
                .select_from(CommunicationSession)
                .where(CommunicationSession.protocol == name)
            )
            or 0
        )
        avg_qber = session.scalar(
            select(func.avg(QkdSession.qber)).where(QkdSession.protocol == name)
        )
        total_runs = (
            session.scalar(
                select(func.count()).select_from(QkdSession).where(QkdSession.protocol == name)
            )
            or 0
        )
        accepted_runs = (
            session.scalar(
                select(func.count())
                .select_from(QkdSession)
                .where(QkdSession.protocol == name, QkdSession.key_status == "ACCEPTED")
            )
            or 0
        )
        attacks_count = (
            session.scalar(
                select(func.count())
                .select_from(Attack)
                .where(
                    Attack.communication_id.in_(
                        select(CommunicationSession.id).where(CommunicationSession.protocol == name)
                    )
                )
            )
            or 0
        )
        avg_confidence = session.scalar(
            select(func.avg(AiRecommendation.confidence)).where(AiRecommendation.protocol == name)
        )
        out.append({
            "name": name,
            "sessions": int(sessions_count),
            "avg_qber": round(float(avg_qber), 6) if avg_qber is not None else None,
            "acceptance_rate": round(accepted_runs / total_runs, 4) if total_runs else 0.0,
            "attacks": int(attacks_count),
            "avg_confidence": round(float(avg_confidence), 4) if avg_confidence is not None else None,
        })

    by_day_rows = session.execute(
        sql_text(
            "SELECT DATE(created_at) AS d, COUNT(*) AS c FROM qkd_sessions "
            "GROUP BY DATE(created_at) ORDER BY d LIMIT 30"
        )
    ).fetchall()
    return {"protocols": out, "by_day": [{"date": str(r[0]), "count": int(r[1])} for r in by_day_rows]}


# ---- B32: audit logs --------------------------------------------------------------


@router.get("/audit-logs")
def audit_logs(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    action: str | None = Query(default=None, max_length=64),
    user_id: int | None = Query(default=None),
    session: Session = SessionDep,
    admin: User = Depends(require_roles(Role.ADMIN)),
):
    base = select(AuditLog).order_by(AuditLog.id.desc())
    count_base = select(func.count()).select_from(AuditLog)
    if action:
        base = base.where(AuditLog.action.like(f"{action}%"))
        count_base = count_base.where(AuditLog.action.like(f"{action}%"))
    if user_id is not None:
        base = base.where(AuditLog.user_id == user_id)
        count_base = count_base.where(AuditLog.user_id == user_id)
    total = session.scalar(count_base) or 0
    rows = session.scalars(base.limit(limit).offset((page - 1) * limit)).all()
    return {
        "items": [_audit_row(session, a) for a in rows],
        "total": int(total),
        "page": page,
        "limit": limit,
    }


# ---- B30: config management (audited) -----------------------------------------------


class ConfigUpdateRequest(BaseModel):
    threshold: float | None = Field(default=None, ge=0.0, le=1.0)


@router.patch("/config")
def update_config(
    body: ConfigUpdateRequest,
    session: Session = SessionDep,
    admin: User = Depends(require_roles(Role.ADMIN)),
):
    if body.threshold is None:
        raise AppError("Nothing to update.", code="VALIDATION_ERROR", status_code=422)
    session.execute(
        sql_text("UPDATE protocol_configs SET default_threshold = :t WHERE enabled = 1"),
        {"t": body.threshold},
    )
    audit(session, "config.update",
          f"simulation threshold updated to {body.threshold} for enabled protocols",
          user_id=admin.id)
    return {"ok": True, "threshold": body.threshold}

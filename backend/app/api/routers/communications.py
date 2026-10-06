"""Communications router (B12/B28): session detail, lists, Eve active list."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.dependencies import SessionDep, get_current_user
from app.core.exceptions import AppError
from app.models import Attack, CommunicationSession, Message, QkdSession, Role, User
from app.services.attack_simulation_service import AttackSimulationService
from app.services.ai_recommendation_service import AiRecommendationService

router = APIRouter(prefix="/communications", tags=["communications"])


def _name(session: Session, user_id: int) -> str:
    u = session.get(User, user_id)
    return u.name if u else "unknown"


def _latest_qber(session: Session, comm_id: int):
    row = (
        session.query(QkdSession)
        .filter(QkdSession.communication_id == comm_id)
        .order_by(QkdSession.id.desc())
        .first()
    )
    return (row.qber, row.threshold, row.key_status) if row else (None, None, "PENDING")


def _detail(session: Session, comm: CommunicationSession) -> dict:
    msg = (
        session.query(Message).filter(Message.communication_id == comm.id).first()
    )
    qber, threshold, key_status = _latest_qber(session, comm.id)
    return {
        "id": comm.id,
        "sender": {"id": comm.sender_id, "name": _name(session, comm.sender_id)},
        "receiver": {"id": comm.receiver_id, "name": _name(session, comm.receiver_id)},
        "protocol": comm.protocol,
        "session_status": comm.session_status,
        "message_status": msg.status if msg else "PENDING",
        "key_status": key_status if key_status else "PENDING",
        "qber": qber,
        "threshold": threshold,
        "attack_detected": bool(msg.attack_detected) if msg else False,
        "created_at": comm.created_at.isoformat(),
        "completed_at": comm.completed_at.isoformat() if comm.completed_at else None,
    }


@router.get("/active")
def active_for_eve(
    session: Session = SessionDep,
    eve: User = Depends(get_current_user),
):
    if eve.role != Role.ATTACKER:
        raise AppError("Attacker role required.", code="ROLE_FORBIDDEN", status_code=403)
    return {"items": AttackSimulationService(session).active_communications(eve.id)}


@router.get("")
def list_communications(
    scope: str = Query(default="mine", pattern="^(mine|history)$"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    status_filter: str | None = Query(default=None, alias="status", max_length=24),
    session: Session = SessionDep,
    user: User = Depends(get_current_user),
):
    base = (
        select(CommunicationSession)
        .where(
            or_(
                CommunicationSession.sender_id == user.id,
                CommunicationSession.receiver_id == user.id,
            )
        )
        .order_by(CommunicationSession.created_at.desc())
    )
    if status_filter:
        base = base.where(CommunicationSession.session_status == status_filter.upper())
    total = session.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = session.scalars(base.limit(limit).offset((page - 1) * limit)).all()
    return {
        "items": [_detail(session, c) for c in rows],
        "total": int(total),
        "page": page,
        "limit": limit,
        "scope": scope,
    }


@router.get("/{comm_id}/timeline")
def communication_timeline(
    comm_id: int,
    session: Session = SessionDep,
    user: User = Depends(get_current_user),
):
    """REST replay of persisted timeline events (F10 bootstrap/reconnect)."""
    comm = session.get(CommunicationSession, comm_id)
    if comm is None:
        raise AppError("Communication not found.",
                       code="COMMUNICATION_NOT_FOUND", status_code=404)
    if user.role != Role.ADMIN and user.id not in (comm.sender_id, comm.receiver_id):
        raise AppError("You do not own this session.",
                       code="FOREIGN_SESSION", status_code=403)
    from app.models import CommunicationEvent

    rows = (
        session.query(CommunicationEvent)
        .filter(CommunicationEvent.communication_id == comm_id)
        .order_by(CommunicationEvent.id.asc())
        .limit(500)
        .all()
    )
    return {
        "events": [
            {
                "type": r.type,
                "state": r.state,
                "previous_state": r.previous_state,
                "timestamp": r.created_at.isoformat(),
            }
            for r in rows
        ]
    }


@router.get("/{comm_id}")
def communication_detail(
    comm_id: int,
    session: Session = SessionDep,
    user: User = Depends(get_current_user),
):
    comm = session.get(CommunicationSession, comm_id)
    if comm is None:
        raise AppError("Communication not found.",
                       code="COMMUNICATION_NOT_FOUND", status_code=404)
    if user.role != Role.ADMIN and user.id not in (comm.sender_id, comm.receiver_id):
        raise AppError("You do not own this session.",
                       code="FOREIGN_SESSION", status_code=403)
    return _detail(session, comm)


@router.get("/{comm_id}/recommendation")
def recommendation(
    comm_id: int,
    session: Session = SessionDep,
    user: User = Depends(get_current_user),
):
    comm = session.get(CommunicationSession, comm_id)
    if comm is None:
        raise AppError("Communication not found.",
                       code="COMMUNICATION_NOT_FOUND", status_code=404)
    if user.role != Role.ADMIN and user.id not in (comm.sender_id, comm.receiver_id):
        raise AppError("You do not own this session.",
                       code="FOREIGN_SESSION", status_code=403)
    rec = AiRecommendationService(session).latest_for(comm_id)
    if rec is None:
        raise AppError("Recommendation not ready.",
                       code="RECOMMENDATION_NOT_READY", status_code=404)
    return {
        "protocol": rec.protocol,
        "confidence": rec.confidence,
        "explanation": rec.explanation,
        "scores": rec.protocol_scores,
        "features": rec.features,
        "evaluated_at": rec.created_at.isoformat(),
    }


@router.get("/{comm_id}/qkd")
def qkd_runs(
    comm_id: int,
    include_sample: bool = Query(default=False),
    session: Session = SessionDep,
    user: User = Depends(get_current_user),
):
    comm = session.get(CommunicationSession, comm_id)
    if comm is None:
        raise AppError("Communication not found.",
                       code="COMMUNICATION_NOT_FOUND", status_code=404)
    if user.role != Role.ADMIN and user.id not in (comm.sender_id, comm.receiver_id):
        raise AppError("You do not own this session.",
                       code="FOREIGN_SESSION", status_code=403)

    runs = (
        session.query(QkdSession)
        .filter(QkdSession.communication_id == comm_id)
        .order_by(QkdSession.id.asc())
        .all()
    )

    def run_dict(r: QkdSession) -> dict:
        # SECURITY: never includes sifted key bits — metadata only.
        d = {
            "id": r.id,
            "protocol": r.protocol,
            "qubits_generated": r.qubits_generated,
            "matching_bases": r.matching_bases,
            "sifted_bits": r.sifted_bits,
            "compared_bits": r.compared_bits,
            "errors": r.errors,
            "qber": r.qber,
            "threshold": r.threshold,
            "key_status": r.key_status,
            "is_baseline": r.is_baseline,
            "created_at": r.created_at.isoformat(),
        }
        if include_sample:
            d["sample"] = r.sample_json or []
        return d

    latest = runs[-1] if runs else None
    return {
        "runs": [run_dict(r) for r in runs],
        "latest_key_status": latest.key_status if latest else "PENDING",
    }


@router.get("/{comm_id}/security")
def security_state(
    comm_id: int,
    session: Session = SessionDep,
    user: User = Depends(get_current_user),
):
    comm = session.get(CommunicationSession, comm_id)
    if comm is None:
        raise AppError("Communication not found.",
                       code="COMMUNICATION_NOT_FOUND", status_code=404)
    if user.role != Role.ADMIN and user.id not in (comm.sender_id, comm.receiver_id):
        raise AppError("You do not own this session.",
                       code="FOREIGN_SESSION", status_code=403)

    msg = session.query(Message).filter(Message.communication_id == comm_id).first()
    qber, threshold, key_status = _latest_qber(session, comm_id)
    decision = "PENDING"
    if key_status in ("ACCEPTED", "REJECTED"):
        decision = key_status
    return {
        "decision": decision,
        "key_status": key_status or "PENDING",
        "attack_detected": bool(msg.attack_detected) if msg else False,
        "qber": qber,
        "threshold": threshold,
        "evaluated_at": comm.completed_at.isoformat()
        if comm.completed_at
        else None,
    }

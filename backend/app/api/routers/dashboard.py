"""Dashboard router: USER summary (F5) — all values computed from DB."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.dependencies import SessionDep, get_current_user
from app.db.base import utcnow
from app.models import Attack, CommunicationSession, Message, QkdSession, User
from app.services.state_machine import ATTACK_WINDOW_STATES

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary")
def user_dashboard(
    session: Session = SessionDep,
    user: User = Depends(get_current_user),
):
    sent_count = (
        session.scalar(select(func.count()).select_from(Message).where(Message.sender_id == user.id)) or 0
    )
    received = (
        session.scalar(
            select(func.count()).select_from(Message).where(
                Message.receiver_id == user.id,
                Message.status.in_(["DELIVERED", "READ"]),
            )
        )
        or 0
    )
    delivered = received
    blocked = (
        session.scalar(
            select(func.count()).select_from(Message).where(
                or_(Message.sender_id == user.id, Message.receiver_id == user.id),
                Message.status == "BLOCKED",
            )
        )
        or 0
    )
    active = (
        session.scalar(
            select(func.count())
            .select_from(CommunicationSession)
            .where(
                or_(
                    CommunicationSession.sender_id == user.id,
                    CommunicationSession.receiver_id == user.id,
                ),
                CommunicationSession.session_status.in_(
                    list(ATTACK_WINDOW_STATES) + ["CREATED", "RECEIVER_VERIFIED",
                                                  "AI_ANALYZING", "PROTOCOL_SELECTED",
                                                  "KEY_ACCEPTED", "ENCRYPTING", "ENCRYPTED"]
                ),
            )
        )
        or 0
    )

    # attacks on my communications
    my_comm_ids = select(CommunicationSession.id).where(
        or_(
            CommunicationSession.sender_id == user.id,
            CommunicationSession.receiver_id == user.id,
        )
    ).scalar_subquery()
    attacks_on_mine = (
        session.scalar(select(func.count()).select_from(Attack).where(Attack.communication_id.in_(my_comm_ids)))
        or 0
    )

    avg_qber = session.scalar(
        select(func.avg(QkdSession.qber)).where(QkdSession.communication_id.in_(my_comm_ids))
    )

    recent_rows = session.scalars(
        select(CommunicationSession)
        .where(
            or_(
                CommunicationSession.sender_id == user.id,
                CommunicationSession.receiver_id == user.id,
            )
        )
        .order_by(CommunicationSession.created_at.desc())
        .limit(5)
    ).all()

    def _brief(c):
        msg = session.query(Message).filter(Message.communication_id == c.id).first()
        return {
            "id": c.id,
            "protocol": c.protocol,
            "session_status": c.session_status,
            "message_status": msg.status if msg else None,
            "created_at": c.created_at.isoformat(),
        }

    return {
        "messages_sent": int(sent_count),
        "messages_received": int(received),
        "messages_delivered": int(delivered),
        "messages_blocked": int(blocked),
        "active_communications": int(active),
        "attacks_on_mine": int(attacks_on_mine),
        "average_qber": round(float(avg_qber), 6) if avg_qber is not None else None,
        "recent": [_brief(c) for c in recent_rows],
    }

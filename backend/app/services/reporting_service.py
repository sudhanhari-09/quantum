"""Reporting service (B27): authoritative security report per message.

Written on BOTH terminal paths (delivered and blocked); every field comes
from stored rows, never computed client-side.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import CommunicationSession, Message, QkdSession, SecurityReport


class ReportingService:
    def __init__(self, session: Session) -> None:
        self.session = session

    def write_report(self, message: Message, comm: CommunicationSession,
                     latest_run: Optional[QkdSession]) -> SecurityReport:
        encryption_status = "ENCRYPTED" if message.encrypted_message else "NOT_ENCRYPTED"
        delivery_status = "DELIVERED" if message.status in ("DELIVERED", "READ") else "BLOCKED"
        qber = latest_run.qber if latest_run is not None else 0.0
        protocol = comm.protocol or latest_run.protocol or "UNKNOWN"
        report = SecurityReport(
            message_id=message.id,
            protocol=protocol,
            qber=qber,
            attack_detected=bool(message.attack_detected),
            key_status=message.key_status or "PENDING",
            encryption_status=encryption_status,
            delivery_status=delivery_status,
        )
        self.session.add(report)
        self.session.flush()
        return report

    def get_for_message(self, message_id: int) -> Optional[SecurityReport]:
        return (
            self.session.query(SecurityReport)
            .filter(SecurityReport.message_id == message_id)
            .order_by(SecurityReport.id.desc())
            .first()
        )

    def list_for_user(self, user_id: int, page: int, limit: int):
        base = (
            select(SecurityReport)
            .join(Message, SecurityReport.message_id == Message.id)
            .where(or_(Message.sender_id == user_id, Message.receiver_id == user_id))
            .order_by(SecurityReport.created_at.desc())
        )
        total = self.session.scalar(select(func.count()).select_from(base.subquery())) or 0
        items = self.session.scalars(
            base.limit(limit).offset((page - 1) * limit)
        ).all()
        return list(items), int(total)

"""Delivery / inbox service (B26) and message blocking (B25).

DeliveryService owns ENCRYPTED -> DELIVERED -> READ transitions. Inbox
queries only ever return status IN (DELIVERED, READ) — blocked messages are
excluded by query contract.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Message


class DeliveryService:
    def __init__(self, session: Session) -> None:
        self.session = session

    def mark_delivered(self, message: Message) -> None:
        # State machine derives ENCRYPTED -> DELIVERED; caller transitions.
        pass

    def mark_read(self, message: Message, reader_id: int) -> Message:
        if reader_id != message.receiver_id:
            from app.core.exceptions import AppError

            raise AppError("Only the receiver can read a message.",
                           code="FOREIGN_MESSAGE", status_code=403)
        if message.status == "DELIVERED":
            from app.services.state_machine import StateMachineService

            comm = message.session
            if comm is not None:
                StateMachineService(self.session).transition(comm, "READ")
        if message.read_at is None:
            message.read_at = datetime.now(timezone.utc)
        return message


class InboxRepository:
    """Query-contract enforcement: BLOCKED/REJECTED never appear in inbox."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def inbox(self, receiver_id: int, page: int, limit: int):
        base = (
            select(Message)
            .where(Message.receiver_id == receiver_id)
            .where(Message.status.in_(["DELIVERED", "READ"]))
            .order_by(Message.created_at.desc())
        )
        total = self.session.scalar(select(func.count()).select_from(base.subquery())) or 0
        items = self.session.scalars(
            base.limit(limit).offset((page - 1) * limit)
        ).all()
        return list(items), int(total)

    def sent(self, sender_id: int, page: int, limit: int):
        base = (
            select(Message)
            .where(Message.sender_id == sender_id)
            .order_by(Message.created_at.desc())
        )  # sent shows ALL statuses incl. BLOCKED (flagged)
        total = self.session.scalar(select(func.count()).select_from(base.subquery())) or 0
        items = self.session.scalars(
            base.limit(limit).offset((page - 1) * limit)
        ).all()
        return list(items), int(total)

    def get_for_owner(self, message_id: int, user_id: int) -> Message | None:
        msg = self.session.get(Message, message_id)
        if msg is None:
            return None
        if user_id not in (msg.sender_id, msg.receiver_id):
            return None
        return msg

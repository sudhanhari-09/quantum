"""Message + CommunicationSession models (Section 11)."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class Message(TimestampMixin, Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    receiver_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    # RECOMMENDED ADDITION: 1:1 link to the owning communication session.
    communication_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("communication_sessions.id"), nullable=True, index=True
    )
    # SECURITY: AES-GCM ciphertext (base64); plaintext is NEVER stored.
    encrypted_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # RECOMMENDED ADDITION: 12-byte nonce base64.
    nonce: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    protocol: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)  # executed protocol
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING", index=True)
    qber: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    key_status: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # PENDING|ACCEPTED|REJECTED
    attack_detected: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    sender: Mapped["User"] = relationship(foreign_keys=[sender_id], back_populates="messages_sent")  # noqa: F821
    receiver: Mapped["User"] = relationship(foreign_keys=[receiver_id], back_populates="messages_received")  # noqa: F821
    session: Mapped[Optional["CommunicationSession"]] = relationship(
        back_populates="message", uselist=False, foreign_keys=[communication_id]
    )


class CommunicationSession(TimestampMixin, Base):
    __tablename__ = "communication_sessions"
    __table_args__ = (
        Index("ix_communication_sessions_sender_status", "sender_id", "session_status"),
        Index("ix_communication_sessions_receiver_status", "receiver_id", "session_status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    receiver_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    protocol: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)  # recommended == executed
    session_status: Mapped[str] = mapped_column(String(24), nullable=False, default="CREATED", index=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    message: Mapped[Message] = relationship(
        back_populates="session",
        uselist=False,
        primaryjoin="CommunicationSession.id == foreign(Message.communication_id)",
    )

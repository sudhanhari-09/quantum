"""Audit log + recommended supporting tables (Section 11)."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, utcnow


class AuditLog(TimestampMixin, Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )  # null for anonymous events
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # SECURITY: redaction policy — never tokens, password hashes, keys or plaintext.
    description: Mapped[str] = mapped_column(Text, nullable=False)

    user: Mapped[Optional["User"]] = relationship()  # noqa: F821


# ---------------------------------------------------------------------------
# RECOMMENDED ADDITION: ai_recommendations — stores the full recommendation and
# input snapshot so recommendation == executed protocol is provable/auditable.
class AiRecommendation(TimestampMixin, Base):
    __tablename__ = "ai_recommendations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    communication_id: Mapped[int] = mapped_column(
        ForeignKey("communication_sessions.id"), nullable=False, index=True
    )
    protocol: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    features: Mapped[dict] = mapped_column(JSON, nullable=False)
    protocol_scores: Mapped[dict] = mapped_column(JSON, nullable=False)

    communication: Mapped["CommunicationSession"] = relationship()  # noqa: F821


# ---------------------------------------------------------------------------
# RECOMMENDED ADDITION: secret_keys — derived QKD key encrypted at rest under
# QSC_MASTER_KEY. NEVER serialized to any API. Rejected path persists no row.
class SecretKey(TimestampMixin, Base):
    __tablename__ = "secret_keys"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    communication_id: Mapped[int] = mapped_column(
        ForeignKey("communication_sessions.id"), nullable=False, index=True
    )
    qkd_session_id: Mapped[int] = mapped_column(ForeignKey("qkd_sessions.id"), nullable=False)
    key_status: Mapped[str] = mapped_column(String(10), nullable=False)  # ACCEPTED
    key_enc: Mapped[str] = mapped_column(Text, nullable=False)  # AES-GCM(base64)

    communication: Mapped["CommunicationSession"] = relationship()  # noqa: F821


# ---------------------------------------------------------------------------
# RECOMMENDED ADDITION: protocol_configs — admin-managed registry config.
class ProtocolConfig(TimestampMixin, Base):
    __tablename__ = "protocol_configs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    protocol: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    default_threshold: Mapped[float] = mapped_column(Numeric(5, 4), nullable=False)
    max_qubits: Mapped[int] = mapped_column(default=256, nullable=False)
    parameters: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


# ---------------------------------------------------------------------------
# RECOMMENDED ADDITION: communication_events — replayable timeline log per
# communication (feeds GET /communications/{id}/timeline for F10).
class CommunicationEvent(Base):
    __tablename__ = "communication_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    communication_id: Mapped[int] = mapped_column(
        ForeignKey("communication_sessions.id"), nullable=False, index=True
    )
    type: Mapped[str] = mapped_column(String(48), nullable=False)
    state: Mapped[Optional[str]] = mapped_column(String(24), nullable=True)
    previous_state: Mapped[Optional[str]] = mapped_column(String(24), nullable=True)
    actor_role: Mapped[Optional[str]] = mapped_column(String(12), nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


# ---------------------------------------------------------------------------
# RECOMMENDED ADDITION: refresh_tokens — JWT refresh rotation.
class RefreshToken(TimestampMixin, Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship()  # noqa: F821

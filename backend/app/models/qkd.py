"""QKD session, attack, security report models (Section 11)."""

from __future__ import annotations

from typing import Optional

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class QkdSession(TimestampMixin, Base):
    """One QKD run for a communication. Append-only: rows are never mutated.

    is_baseline=True marks the pre-attack run; post-attack reruns (B23)
    append new rows with is_baseline=False.
    """

    __tablename__ = "qkd_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    communication_id: Mapped[int] = mapped_column(
        ForeignKey("communication_sessions.id"), nullable=False, index=True
    )
    protocol: Mapped[str] = mapped_column(String(32), nullable=False)
    # RNG seed persisted per run so post-attack reruns are deterministic.
    seed: Mapped[int] = mapped_column(nullable=False, default=0)
    qubits_generated: Mapped[int] = mapped_column(Integer, nullable=False)
    matching_bases: Mapped[int] = mapped_column(Integer, nullable=False)
    # SECURITY: metadata only — sifted key BITS are never serialized to APIs;
    # this column stores the length of the sifted key material.
    sifted_bits: Mapped[int] = mapped_column(Integer, nullable=False)
    compared_bits: Mapped[int] = mapped_column(Integer, nullable=False)  # RECOMMENDED ADDITION (QBER denominator)
    errors: Mapped[int] = mapped_column(Integer, nullable=False)
    qber: Mapped[float] = mapped_column(Float, nullable=False)
    threshold: Mapped[float] = mapped_column(Float, nullable=False)  # threshold used for THIS run
    key_status: Mapped[str] = mapped_column(String(10), nullable=False)  # PENDING|ACCEPTED|REJECTED
    is_baseline: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # RECOMMENDED ADDITION: visualization sample of the first N qubit rounds
    # (no key material — public-basis/bit metadata only).
    sample_json: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)

    communication: Mapped["CommunicationSession"] = relationship()  # noqa: F821


class Attack(TimestampMixin, Base):
    __tablename__ = "attacks"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    attacker_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    communication_id: Mapped[int] = mapped_column(
        ForeignKey("communication_sessions.id"), nullable=False, index=True
    )
    attack_type: Mapped[str] = mapped_column(String(32), nullable=False)  # INTERCEPT_AND_RESEND
    attack_strength: Mapped[float] = mapped_column(Float, nullable=False)  # p in [0.1, 1.0]
    states_intercepted: Mapped[int] = mapped_column(Integer, nullable=False)
    states_modified: Mapped[int] = mapped_column(Integer, nullable=False)
    qber_before: Mapped[float] = mapped_column(Float, nullable=False)
    qber_after: Mapped[float] = mapped_column(Float, nullable=False)
    detection_status: Mapped[str] = mapped_column(String(16), nullable=False)  # DETECTED|NOT_DETECTED

    attacker: Mapped["User"] = relationship()  # noqa: F821
    communication: Mapped["CommunicationSession"] = relationship()  # noqa: F821


class SecurityReport(TimestampMixin, Base):
    __tablename__ = "security_reports"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("messages.id"), nullable=False, index=True)
    protocol: Mapped[str] = mapped_column(String(32), nullable=False)
    qber: Mapped[float] = mapped_column(Float, nullable=False)
    attack_detected: Mapped[bool] = mapped_column(Boolean, nullable=False)
    key_status: Mapped[str] = mapped_column(String(10), nullable=False)
    encryption_status: Mapped[str] = mapped_column(String(20), nullable=False)  # ENCRYPTED|NOT_ENCRYPTED|SKIPPED
    delivery_status: Mapped[str] = mapped_column(String(10), nullable=False)  # DELIVERED|BLOCKED|PENDING

    message: Mapped["Message"] = relationship()  # noqa: F821

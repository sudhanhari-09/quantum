"""User model + roles (Section 11: users)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.db.base import Base, TimestampMixin


class Role:
    USER = "USER"
    ATTACKER = "ATTACKER"
    ADMIN = "ADMIN"

    ALL = (USER, ATTACKER, ADMIN)


class User(TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role IN ('USER','ATTACKER','ADMIN')", name="role_valid"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    unique_user_id: Mapped[str] = mapped_column(
        String(14), unique=True, index=True, nullable=False
    )  # QSC-[A-Z0-9]{10}
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)  # stored lowercase
    # SECURITY: bcrypt hash only; never serialized to any API response.
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    role: Mapped[str] = mapped_column(String(10), nullable=False, default=Role.USER)
    # RECOMMENDED ADDITION: soft-disable instead of delete.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    messages_sent: Mapped[list["Message"]] = relationship(  # noqa: F821
        foreign_keys="Message.sender_id", back_populates="sender"
    )
    messages_received: Mapped[list["Message"]] = relationship(  # noqa: F821
        foreign_keys="Message.receiver_id", back_populates="receiver"
    )

    @validates("email")
    def _normalize_email(self, _: str, value: str) -> str:
        # Case-insensitive uniqueness is enforced by normalizing to lowercase;
        # the unique index then covers every case variant.
        return (value or "").strip().lower()

    @property
    def created_at_dt(self) -> datetime:
        return self.created_at

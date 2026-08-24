"""Audit service: complete, redacted event trail (B32 core used from B6 on)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.models import AuditLog, User

logger = get_logger("audit")

# SECURITY redaction policy: never log tokens/password hashes/keys/plaintext.
FORBIDDEN_SUBSTRINGS = ("password", "token", "key_enc", "content")


def record(
    session: Session,
    action: str,
    description: str,
    user_id: int | None = None,
) -> None:
    lowered = description.lower()
    for forbidden in FORBIDDEN_SUBSTRINGS:
        if forbidden in lowered:
            logger.error("audit.redaction_blocked action=%s (description suppressed)", action)
            description = f"{action} performed"
            break
    session.add(AuditLog(user_id=user_id, action=action, description=description))

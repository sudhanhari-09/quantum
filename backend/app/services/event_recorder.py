"""Communication event persistence: replayable timeline source of truth."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models import CommunicationEvent


def record(
    session: Session,
    communication_id: int,
    event_type: str,
    *,
    state: str | None = None,
    previous_state: str | None = None,
    actor_role: str = "SYSTEM",
    payload: dict[str, Any] | None = None,
) -> None:
    """Persist one timeline entry (same transaction as the domain change)."""
    session.add(
        CommunicationEvent(
            communication_id=communication_id,
            type=event_type,
            state=state,
            previous_state=previous_state,
            actor_role=actor_role,
            payload=payload or {},
        )
    )

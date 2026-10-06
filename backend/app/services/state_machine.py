"""Communication state machine (B13) — Section 08 vocabulary + transition table.

The StateMachineService is the ONLY component allowed to change
communication_sessions.session_status. Transitions are atomic with the
row update; WS events and audit rows are emitted by callers after commit.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.db.base import utcnow
from app.models import CommunicationSession, Message

# ---- fixed vocabulary --------------------------------------------------------

STATES = (
    "CREATED", "RECEIVER_VERIFIED", "AI_ANALYZING", "PROTOCOL_SELECTED",
    "QKD_INITIALIZING", "QKD_RUNNING", "KEY_SIFTING", "QBER_EVALUATION",
    "SECURITY_CHECK", "KEY_ACCEPTED", "ENCRYPTING", "ENCRYPTED", "DELIVERED",
    "READ", "ATTACK_DETECTED", "KEY_REJECTED", "BLOCKED", "FAILED",
)

TERMINAL_STATES = {"READ", "BLOCKED", "FAILED"}

ATTACK_WINDOW_STATES = {
    "QKD_INITIALIZING", "QKD_RUNNING", "KEY_SIFTING", "QBER_EVALUATION",
    "SECURITY_CHECK",
}

MAX_REATTACKS = 3  # [REC]

LEGAL_TRANSITIONS: dict[str, set[str]] = {
    "CREATED": {"RECEIVER_VERIFIED"},
    "RECEIVER_VERIFIED": {"AI_ANALYZING"},
    "AI_ANALYZING": {"PROTOCOL_SELECTED"},
    "PROTOCOL_SELECTED": {"QKD_INITIALIZING"},
    "QKD_INITIALIZING": {"QKD_RUNNING", "ATTACK_DETECTED"},
    "QKD_RUNNING": {"QKD_RUNNING", "KEY_SIFTING", "ATTACK_DETECTED"},  # self-loop = progress ticks
    "KEY_SIFTING": {"QBER_EVALUATION", "ATTACK_DETECTED"},
    "QBER_EVALUATION": {"SECURITY_CHECK", "ATTACK_DETECTED"},
    "SECURITY_CHECK": {"KEY_ACCEPTED", "ATTACK_DETECTED"},
    "KEY_ACCEPTED": {"ENCRYPTING"},
    "ENCRYPTING": {"ENCRYPTED"},
    "ENCRYPTED": {"DELIVERED"},
    "DELIVERED": {"READ"},
    "READ": set(),
    "ATTACK_DETECTED": {"KEY_REJECTED"},
    "KEY_REJECTED": {"BLOCKED"},
    "BLOCKED": set(),
    "FAILED": set(),
}

# Derived status mapping (Section 08) — used by all API responses.
DERIVED_STATUS: dict[str, tuple[str, str]] = {
    # session_status -> (message.status, key_status)
    "CREATED": ("PENDING", "PENDING"),
    "RECEIVER_VERIFIED": ("VERIFIED", "PENDING"),
    "AI_ANALYZING": ("PROCESSING", "PENDING"),
    "PROTOCOL_SELECTED": ("PROCESSING", "PENDING"),
    "QKD_INITIALIZING": ("PROCESSING", "PENDING"),
    "QKD_RUNNING": ("PROCESSING", "PENDING"),
    "KEY_SIFTING": ("PROCESSING", "PENDING"),
    "QBER_EVALUATION": ("PROCESSING", "PENDING"),
    "SECURITY_CHECK": ("PROCESSING", "PENDING"),
    "KEY_ACCEPTED": ("PROCESSING", "ACCEPTED"),
    "ENCRYPTING": ("ENCRYPTED", "ACCEPTED"),
    "ENCRYPTED": ("ENCRYPTED", "ACCEPTED"),
    "DELIVERED": ("DELIVERED", "ACCEPTED"),
    "READ": ("READ", "ACCEPTED"),
    "ATTACK_DETECTED": ("REJECTED", "REJECTED"),
    "KEY_REJECTED": ("BLOCKED", "REJECTED"),
    "BLOCKED": ("BLOCKED", "REJECTED"),
    "FAILED": ("FAILED", "PENDING"),
}


def validate_transition(current: str, new: str) -> bool:
    if current not in LEGAL_TRANSITIONS or new not in STATES:
        return False
    if current in TERMINAL_STATES:
        return False
    return new in LEGAL_TRANSITIONS[current]


class InvalidStateTransition(AppError):
    status_code = 409
    code = "INVALID_STATE_TRANSITION"
    message = "Illegal communication state transition."


class StateMachineService:
    def __init__(self, session: Session) -> None:
        self.session = session

    def transition(
        self,
        comm: CommunicationSession,
        new_state: str,
        actor_role: str = "SYSTEM",
    ) -> str:
        """Validate + apply a transition atomically (same DB transaction).

        Every transition broadcasts communication.state_changed (Section 08)
        and persists a timeline entry for REST replay.
        """
        current = comm.session_status
        if not validate_transition(current, new_state):
            raise InvalidStateTransition(
                f"Cannot transition {current} -> {new_state}.",
                details={"from": current, "to": new_state},
            )
        comm.session_status = new_state
        if new_state in TERMINAL_STATES and comm.completed_at is None:
            comm.completed_at = utcnow()

        # Keep derived message fields in sync (Section 08 mapping).
        message: Optional[Message] = getattr(comm, "message", None)
        if message is None and comm.id is not None:
            message = (
                self.session.query(Message)
                .filter(Message.communication_id == comm.id)
                .first()
            )
        if message is not None:
            msg_status, key_status = DERIVED_STATUS[new_state]
            message.status = msg_status
            message.key_status = key_status

        # Broadcast + persist the transition (Section 08 / Section 16).
        from app.services.event_recorder import record as record_event
        from app.services.realtime_service import realtime

        channels = ["user", "admin", f"comm:{comm.id}"]
        # Eve is notified from the moment the window OPENS (new_state) through
        # every in-window transition (current) until it closes (ATTACK_DETECTED /
        # BLOCKED). Without `new_state`, the QKD_INITIALIZING announcement would
        # never reach Eve and her target list could not refresh itself live.
        if (
            current in ATTACK_WINDOW_STATES
            or new_state in ATTACK_WINDOW_STATES
            or new_state in ("ATTACK_DETECTED", "BLOCKED")
        ):
            channels.append("eve")
        realtime.emit(
            channels,
            "communication.state_changed",
            communication_id=comm.id,
            state=new_state,
            actor_role=actor_role,
            payload={"previous_state": current, "state": new_state},
        )
        record_event(
            self.session,
            comm.id,
            "communication.state_changed",
            state=new_state,
            previous_state=current,
            actor_role=actor_role,
            payload={"previous_state": current},
        )
        return new_state

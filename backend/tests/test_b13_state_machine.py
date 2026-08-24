"""B13 acceptance: every legal edge passes; every illegal edge is rejected."""

from __future__ import annotations

import pytest

from app.core.exceptions import AppError
from app.services.state_machine import (
    ATTACK_WINDOW_STATES,
    DERIVED_STATUS,
    LEGAL_TRANSITIONS,
    STATES,
    TERMINAL_STATES,
    StateMachineService,
    validate_transition,
)


def test_all_legal_edges_pass():
    for src, dsts in LEGAL_TRANSITIONS.items():
        for dst in dsts:
            assert validate_transition(src, dst), f"{src}->{dst} must be legal"


def test_every_illegal_edge_rejected():
    for src, dsts in LEGAL_TRANSITIONS.items():
        for other in STATES:
            if other not in dsts:
                assert not validate_transition(src, other), f"{src}->{other} must be illegal"
    # unknown states rejected
    assert not validate_transition("MADE_UP", "CREATED")
    assert not validate_transition("CREATED", "MADE_UP")


def test_terminal_states_have_no_outgoing():
    for t in TERMINAL_STATES:
        assert LEGAL_TRANSITIONS[t] == set()
    for t in ("READ", "BLOCKED", "FAILED"):
        assert not validate_transition(t, "CREATED")


def test_normal_happy_path_sequence():
    path = [
        "RECEIVER_VERIFIED", "AI_ANALYZING", "PROTOCOL_SELECTED",
        "QKD_INITIALIZING", "QKD_RUNNING", "KEY_SIFTING", "QBER_EVALUATION",
        "SECURITY_CHECK", "KEY_ACCEPTED", "ENCRYPTING", "ENCRYPTED",
        "DELIVERED", "READ",
    ]
    current = "CREATED"
    for nxt in path:
        assert validate_transition(current, nxt)
        current = nxt
    assert current in TERMINAL_STATES


def test_attack_path_from_window_states():
    for state in ATTACK_WINDOW_STATES:
        assert "ATTACK_DETECTED" in LEGAL_TRANSITIONS[state], state
    # outside window: no attack transition
    for state in ("CREATED", "KEY_ACCEPTED", "ENCRYPTED"):
        assert "ATTACK_DETECTED" not in LEGAL_TRANSITIONS[state]


def test_service_transitions_update_derived_message_fields(in_memory_db):
    from app.models import CommunicationSession, Message, User

    with in_memory_db() as s:
        sender = User(unique_user_id="QSC-AAAAAAA001", name="S", email="s@t.io",
                      password_hash="x", role="USER")
        receiver = User(unique_user_id="QSC-AAAAAAA002", name="R", email="r@t.io",
                        password_hash="x", role="USER")
        s.add_all([sender, receiver])
        s.flush()
        comm = CommunicationSession(sender_id=sender.id, receiver_id=receiver.id)
        msg = Message(sender_id=sender.id, receiver_id=receiver.id, status="PENDING")
        s.add(comm)
        s.flush()
        msg.communication_id = comm.id
        s.add(msg)
        s.flush()

        sm = StateMachineService(s)
        path = ["RECEIVER_VERIFIED", "AI_ANALYZING", "PROTOCOL_SELECTED",
                "QKD_INITIALIZING", "QKD_RUNNING", "KEY_SIFTING", "QBER_EVALUATION",
                "SECURITY_CHECK", "KEY_ACCEPTED", "ENCRYPTING", "ENCRYPTED",
                "DELIVERED", "READ"]
        for nxt in path:
            sm.transition(comm, nxt)

        assert comm.session_status == "READ"
        assert msg.status == "READ"
        assert msg.key_status == "ACCEPTED"
        assert comm.completed_at is not None


def test_service_rejects_illegal_transition(in_memory_db):
    from app.models import CommunicationSession, User

    with in_memory_db() as s:
        sender = User(unique_user_id="QSC-AAAAAAA003", name="S3", email="s3@t.io",
                      password_hash="x", role="USER")
        receiver = User(unique_user_id="QSC-AAAAAAA004", name="R4", email="r4@t.io",
                        password_hash="x", role="USER")
        s.add_all([sender, receiver])
        s.flush()
        comm = CommunicationSession(sender_id=sender.id, receiver_id=receiver.id)
        s.add(comm)
        s.flush()

        sm = StateMachineService(s)
        with pytest.raises(AppError) as excinfo:
            sm.transition(comm, "DELIVERED")  # skipping is illegal
        assert excinfo.value.code == "INVALID_STATE_TRANSITION"

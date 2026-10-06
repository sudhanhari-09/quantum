"""Eve active-communication visibility (end-to-end contract for the EVE demo).

Covers the exact flow the EVE dashboard depends on:

  USER A -> USER B session
    -> appears in GET /api/v1/communications/active (ATTACKER only)
       with the REAL communication id + safe metadata
    -> the window-open transition notifies the "eve" realtime channel
       (backend half of "no manual browser refresh")
    -> the listed id launches the existing INTERCEPT_AND_RESEND attack
       through the real QKD rerun / security evaluation pipeline.

Only metadata is exposed: no plaintext, no key material.
"""

from __future__ import annotations

import asyncio

import pytest

from tests.conftest import auth_headers, login, register_user

WINDOW = {
    "QKD_INITIALIZING",
    "QKD_RUNNING",
    "KEY_SIFTING",
    "QBER_EVALUATION",
    "SECURITY_CHECK",
}


async def _promote_attacker(creds) -> None:
    from sqlalchemy import text

    from app.db.session import get_engine

    with get_engine().begin() as conn:
        conn.execute(
            text("UPDATE users SET role='ATTACKER' WHERE email=:e"),
            {"e": creds["email"]},
        )


async def _window_comm(client, sender_creds, receiver_creds, content="eve visibility probe"):
    """Create a real session and park it inside the attack window (QBER_EVALUATION)."""
    from app.db.session import session_scope
    from app.services.ai_recommendation_service import AiRecommendationService
    from app.services.auth_service import AuthService
    from app.services.messaging_service import MessagingService
    from app.services.qkd_service import QkdService

    with session_scope() as s:
        sender = AuthService(s).users.get_by_email(sender_creds["email"])
        receiver = AuthService(s).users.get_by_email(receiver_creds["email"])
        ms = MessagingService(s)
        msg, comm = ms.create_message(sender, receiver.unique_user_id, content, "MEDIUM")
        sm = ms.state_machine
        sm.transition(comm, "AI_ANALYZING")
        rec = AiRecommendationService(s).recommend(comm, "MEDIUM")
        comm.protocol = rec.protocol
        msg.protocol = rec.protocol
        sm.transition(comm, "PROTOCOL_SELECTED")
        sm.transition(comm, "QKD_INITIALIZING")
        sm.transition(comm, "QKD_RUNNING")
        baseline, _ = QkdService(s).execute_baseline(comm)
        sm.transition(comm, "KEY_SIFTING")
        sm.transition(comm, "QBER_EVALUATION")
        return {
            "comm_id": comm.id,
            "msg_id": msg.id,
            "sender_id": sender.id,
            "receiver_id": receiver.id,
            "baseline_qber": baseline.qber,
        }


async def _attacker_tokens(client, name="EveVis", email="eve.visibility@test.io"):
    _, creds = await register_user(client, name, email, password="EvePass123!")
    await _promote_attacker(creds)
    return await login(client, creds)


async def test_active_list_returns_real_user_to_user_communication(client):
    _, alice_creds = await register_user(client, "Alice", "alice.evis@test.io")
    _, bob_creds = await register_user(client, "Bob", "bob.evis@test.io")
    ctx = await _window_comm(client, alice_creds, bob_creds)
    eve_tokens = await _attacker_tokens(client)

    resp = await client.get("/api/v1/communications/active", headers=auth_headers(eve_tokens))
    assert resp.status_code == 200
    items = resp.json()["items"]
    target = next((i for i in items if i["id"] == ctx["comm_id"]), None)
    assert target is not None, "USER->USER window session must be visible to EVE"

    # The id EVE targets IS the backend communication id.
    assert target["communication_id"] == ctx["comm_id"] == target["id"]
    assert target["sender_id"] == ctx["sender_id"] and target["sender_name"] == "Alice"
    assert target["receiver_id"] == ctx["receiver_id"] and target["receiver_name"] == "Bob"
    assert target["protocol"]  # selected before QKD started
    assert target["session_state"] in WINDOW
    assert target["status"] == target["session_state"]
    assert target["attackable"] is True
    assert target["attack_types"] == ["INTERCEPT_AND_RESEND"]
    assert target["qber"] == pytest.approx(ctx["baseline_qber"])
    assert target["threshold"] is not None
    assert target["created_at"]

    # Privacy: metadata only - never the plaintext or key material.
    flat = str(target).lower()
    for forbidden in ("probe", "secret", "sifted", "password", "nonce", "key_bits"):
        assert forbidden not in flat


async def test_active_list_excludes_the_requesting_attacker(client):
    _, alice_creds = await register_user(client, "Alice", "alice.evis2@test.io")
    _, bob_creds = await register_user(client, "Bob", "bob.evis2@test.io")
    _, eve_creds = await register_user(client, "EveOwn", "eve.own@test.io",
                                       password="EvePass123!")
    await _promote_attacker(eve_creds)

    victim = await _window_comm(client, alice_creds, bob_creds)
    # EVE's own window session must never be offered back to her as a target.
    own = await _window_comm(client, eve_creds, alice_creds, content="eve owned session")

    eve_tokens = await login(client, eve_creds)
    items = (await client.get("/api/v1/communications/active",
                              headers=auth_headers(eve_tokens))).json()["items"]
    ids = {i["id"] for i in items}
    assert victim["comm_id"] in ids
    assert own["comm_id"] not in ids


async def test_window_open_notifies_eve_realtime_channel(client):
    """The transition that OPENS the window must reach the 'eve' channel.

    This is the backend half of "no manual browser refresh": the frontend
    invalidates ['communications','active'] on communication.state_changed.
    """
    _, alice_creds = await register_user(client, "Alice", "alice.evis3@test.io")
    _, bob_creds = await register_user(client, "Bob", "bob.evis3@test.io")

    from app.db.session import session_scope
    from app.models import CommunicationSession
    from app.services.ai_recommendation_service import AiRecommendationService
    from app.services.auth_service import AuthService
    from app.services.messaging_service import MessagingService
    from app.services.realtime_service import realtime
    from app.services.state_machine import StateMachineService

    with session_scope() as s:
        sender = AuthService(s).users.get_by_email(alice_creds["email"])
        receiver = AuthService(s).users.get_by_email(bob_creds["email"])
        ms = MessagingService(s)
        _, comm = ms.create_message(sender, receiver.unique_user_id, "window probe", "MEDIUM")
        ms.state_machine.transition(comm, "AI_ANALYZING")
        rec = AiRecommendationService(s).recommend(comm, "MEDIUM")
        comm.protocol = rec.protocol
        ms.state_machine.transition(comm, "PROTOCOL_SELECTED")
        comm_id = comm.id

    queue = realtime.subscribe("eve")
    try:
        with session_scope() as s:
            comm = s.get(CommunicationSession, comm_id)
            StateMachineService(s).transition(comm, "QKD_INITIALIZING")

        # RealtimeService may deliver via call_soon_threadsafe; give it a tick.
        envelopes = []
        for _ in range(20):
            await asyncio.sleep(0)
            while True:
                try:
                    envelopes.append(queue.get_nowait())
                except asyncio.QueueEmpty:
                    break
            if envelopes:
                break

        match = [
            e for e in envelopes
            if e["type"] == "communication.state_changed"
            and e["communication_id"] == comm_id
        ]
        assert match, f"eve channel never received the window-open event: {envelopes}"
        assert match[0]["state"] == "QKD_INITIALIZING"
    finally:
        realtime.unsubscribe("eve", queue)


async def test_listed_id_launches_real_attack_and_closes_window(client):
    _, alice_creds = await register_user(client, "Alice", "alice.evis4@test.io")
    _, bob_creds = await register_user(client, "Bob", "bob.evis4@test.io")
    ctx = await _window_comm(client, alice_creds, bob_creds)
    eve_tokens = await _attacker_tokens(client, "EveAtk", "eve.evis4@test.io")

    items = (await client.get("/api/v1/communications/active",
                              headers=auth_headers(eve_tokens))).json()["items"]
    target = next(i for i in items if i["id"] == ctx["comm_id"])

    # Attack the REAL communication id taken from EVE's list.
    resp = await client.post(
        f"/api/v1/communications/{target['communication_id']}/attacks",
        json={"attack_type": "INTERCEPT_AND_RESEND", "attack_strength": 1.0},
        headers=auth_headers(eve_tokens),
    )
    assert resp.status_code == 201, resp.text
    attack = resp.json()
    assert attack["communication_id"] == ctx["comm_id"]
    assert attack["detection_status"] == "DETECTED"
    assert attack["qber_after"] > attack["qber_before"]
    assert attack["session_state"] == "BLOCKED"

    # The window is closed: the session disappears from EVE's list.
    after = (await client.get("/api/v1/communications/active",
                              headers=auth_headers(eve_tokens))).json()["items"]
    assert ctx["comm_id"] not in {i["id"] for i in after}

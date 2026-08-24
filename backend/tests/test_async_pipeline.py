"""Async-pipeline contract: 202/CREATED + background completion (live mode)."""

from __future__ import annotations

import asyncio

import pytest

from tests.conftest import auth_headers, login, register_user


async def test_202_returns_created_and_pipeline_completes(client, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(
        type(get_settings()), "process_async", True
    ) if False else None
    # pydantic-settings instance attr override:
    get_settings().process_async = True
    get_settings().pipeline_stage_delay_ms = 250
    try:
        alice_user, alice_creds = await register_user(client, "Alice", "alice.async@test.io")
        bob_user, bob_creds = await register_user(client, "Bob", "bob.async@test.io")
        atok = await login(client, alice_creds)
        btok = await login(client, bob_creds)

        resp = await client.post(
            "/api/v1/messages",
            json={"receiver_qsc_id": bob_user["unique_user_id"],
                  "content": "async contract", "security_requirement": "MEDIUM"},
            headers=auth_headers(atok),
        )
        assert resp.status_code == 202
        body = resp.json()
        assert body["status"] == "CREATED"
        comm_id = body["communication_id"]
        msg_id = body["message_id"]

        # poll until the background pipeline reaches a terminal state
        final = None
        for _ in range(100):
            detail = (
                await client.get(f"/api/v1/communications/{comm_id}", headers=auth_headers(atok))
            ).json()
            if detail["session_status"] in ("DELIVERED", "BLOCKED", "READ", "FAILED"):
                final = detail["session_status"]
                break
            await asyncio.sleep(0.05)
        assert final == "DELIVERED", detail

        opened = (
            await client.get(f"/api/v1/messages/{msg_id}", headers=auth_headers(btok))
        ).json()
        assert opened["content"] == "async contract" and opened["status"] == "READ"

        # timeline recorded the whole staged run
        tl = (
            await client.get(f"/api/v1/communications/{comm_id}/timeline",
                             headers=auth_headers(atok))
        ).json()["events"]
        types = [e["type"] for e in tl]
        for expected in ("qkd.started", "qkd.progress", "security.key_accepted",
                         "message.delivered"):
            assert expected in types
    finally:
        get_settings().process_async = False
        get_settings().pipeline_stage_delay_ms = 1200


async def test_attack_window_visibility_mechanism(client):
    """commit_each_stage makes intermediate window-states VISIBLE mid-run.

    Note: under httpx ASGITransport the background task completes before the
    client sees the 202, so the true HTTP race is proven only against a live
    uvicorn server (scripts/live_attack_proof.py). Here we deterministically
    verify the visibility mechanism itself across two independent sessions.
    """
    import threading

    from app.models import CommunicationSession, Message

    alice_user, _ = await register_user(client, "Alice", "alice.aw@test.io")
    bob_user, bob_creds = await register_user(client, "Bob", "bob.aw@test.io")

    from app.db.session import session_scope
    from app.services.auth_service import AuthService
    from app.services.messaging_service import MessagingService

    with session_scope() as s:
        svc = AuthService(s)
        sender = svc.users.get_by_email("alice.aw@test.io")
        receiver = svc.users.get_by_email("bob.aw@test.io")
        ms = MessagingService(s)
        msg, comm = ms.create_message(sender, receiver.unique_user_id,
                                      "window visibility", "HIGH")
        msg_id, comm_id = msg.id, comm.id

    observed: list[str] = []
    done = threading.Event()

    def runner() -> None:
        with session_scope() as s:
            m = s.get(Message, msg_id)
            c = s.get(CommunicationSession, comm_id)
            MessagingService(s).run_secure_pipeline(
                m, "window visibility", "HIGH",
                stage_delay=0.12, commit_each_stage=True,
            )
        done.set()

    t = threading.Thread(target=runner, daemon=True)
    t.start()

    WINDOW = {"QKD_INITIALIZING", "QKD_RUNNING", "KEY_SIFTING",
              "QBER_EVALUATION", "SECURITY_CHECK"}
    while not done.is_set():
        with session_scope() as s2:
            row = s2.get(CommunicationSession, comm_id)
            if row is not None:
                observed.append(row.session_status)
        if done.wait(timeout=0.02):
            break
    done.wait(timeout=30)

    assert any(st in WINDOW for st in observed), f"window never visible: {observed}"

    btok = await login(client, bob_creds)
    detail = (
        await client.get(f"/api/v1/communications/{comm_id}", headers=auth_headers(btok))
    ).json()
    assert detail["session_status"] in ("DELIVERED", "READ")
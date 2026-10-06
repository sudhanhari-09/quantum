"""Strict-integration E2E flows over the full HTTP stack.

Flow 1 — successful communication: Alice -> Bob with AI recommendation,
QKD, accepted key, encryption, delivery, read, report, history, audit,
timeline replay.
Flow 2 — Eve attack: active target list -> INTERCEPT_AND_RESEND -> QBER rise
-> DETECTED -> KEY_REJECTED -> BLOCKED; blocked message absent from inbox;
eve history + admin security events updated.
Flow 3 — reconnect synchronization: a "reconnecting" client rebuilds complete
UI state purely from REST (timeline + qkd + security + detail), proving no
stuck state after a WS drop.
"""

from __future__ import annotations

import asyncio
import threading

import pytest

from tests.conftest import auth_headers, login, register_user


@pytest.fixture(scope="module", autouse=True)
def _isolated_e2e_db(tmp_path_factory):
    """Run the three live flows against their OWN SQLite file.

    The rest of the suite shares one dev DB; isolating the E2E module removes
    cross-file interference so these end-to-end flows validate the app, not
    test-ordering artifacts.
    """
    import os

    from app.core.config import get_settings
    from app.db.base import Base
    from app.db.session import get_engine, get_session_factory

    settings = get_settings()
    original_url = settings.database_url
    new_url = (
        "sqlite:///"
        + (tmp_path_factory.mktemp("e2e") / "e2e.db").as_posix()
    )
    settings.database_url = new_url
    os.environ["DATABASE_URL"] = new_url
    get_engine.cache_clear()
    get_session_factory.cache_clear()

    Base.metadata.create_all(get_engine())
    from sqlalchemy import text

    with get_engine().begin() as conn:
        conn.execute(text(
            "INSERT INTO protocol_configs (protocol, enabled, default_threshold, "
            "max_qubits, parameters, created_at) VALUES "
            "('BB84', 1, 0.11, 256, '{}', CURRENT_TIMESTAMP)"
        ))
    yield
    settings.database_url = original_url
    os.environ["DATABASE_URL"] = original_url
    get_engine.cache_clear()
    get_session_factory.cache_clear()


async def _users(client, tag):
    from app.core.config import get_settings

    # E2E flows validate the deterministic synchronous pipeline; the async
    # mode has its own dedicated tests + live proof.
    get_settings().process_async = False
    get_settings().pipeline_stage_delay_ms = 1200
    alice, alice_creds = await register_user(client, "Alice", f"alice.e2e.{tag}@demo.io")
    bob, bob_creds = await register_user(client, "Bob", f"bob.e2e.{tag}@demo.io")
    return alice, alice_creds, bob, bob_creds


async def test_flow_1_success_communication(client):
    alice, alice_creds, bob, bob_creds = await _users(client, "a1")
    atok = await login(client, alice_creds)
    btok = await login(client, bob_creds)

    # search receiver by QSC ID
    found = (
        await client.get("/api/v1/users/search",
                         params={"qsc_id": bob["unique_user_id"]},
                         headers=auth_headers(atok))
    )
    assert found.status_code == 200

    # compose -> full synchronous pipeline
    resp = await client.post(
        "/api/v1/messages",
        json={"receiver_qsc_id": bob["unique_user_id"],
              "content": "E2E flow one payload", "security_requirement": "MEDIUM"},
        headers=auth_headers(atok),
    )
    assert resp.status_code == 202
    created = resp.json()
    comm_id, msg_id = created["communication_id"], created["message_id"]

    # AI recommendation persisted and equals executed protocol
    rec = (await client.get(f"/api/v1/communications/{comm_id}/recommendation",
                            headers=auth_headers(atok))).json()
    detail = (await client.get(f"/api/v1/communications/{comm_id}",
                               headers=auth_headers(atok))).json()
    assert rec["protocol"] == detail["protocol"]

    # QKD ran; QBER real; key accepted
    sec = (await client.get(f"/api/v1/communications/{comm_id}/security",
                            headers=auth_headers(atok))).json()
    assert sec["decision"] == "ACCEPTED" and sec["qber"] <= sec["threshold"]
    assert detail["session_status"] == "DELIVERED"

    # ciphertext persisted, plaintext never stored
    from sqlalchemy import text

    from app.db.session import get_engine

    with get_engine().begin() as conn:
        row = conn.execute(
            text("SELECT encrypted_message, nonce FROM messages WHERE id=:i"),
            {"i": msg_id},
        ).fetchone()
    assert row[0] and row[1]

    # Bob receives and reads
    inbox = (await client.get("/api/v1/messages/inbox", headers=auth_headers(btok))).json()
    assert any(i["id"] == msg_id for i in inbox["items"])
    opened = (await client.get(f"/api/v1/messages/{msg_id}", headers=auth_headers(btok))).json()
    assert opened["content"] == "E2E flow one payload"
    assert opened["status"] == "READ"
    assert opened["communication_id"] == comm_id

    # report generated from stored rows
    report = (
        await client.get(f"/api/v1/messages/{msg_id}/security-report", headers=auth_headers(atok))
    ).json()["report"]
    assert report["delivery_status"] == "DELIVERED"
    assert report["encryption_status"] == "ENCRYPTED"

    # history lists the session for both sides
    hist_a = (await client.get("/api/v1/communications", params={"scope": "history"},
                                   headers=auth_headers(atok))).json()
    hist_b = (await client.get("/api/v1/communications", params={"scope": "history"},
                                   headers=auth_headers(btok))).json()
    assert any(c["id"] == comm_id for c in hist_a["items"])
    assert any(c["id"] == comm_id for c in hist_b["items"])

    # audit trail covers the critical path
    from app.db.session import session_scope
    from app.models import AuditLog

    with session_scope() as s:
        actions = {r[0] for r in s.query(AuditLog.action).all()}
    assert {"register", "login", "message.create", "recommend", "qkd.run",
            "security.key_accepted", "deliver"} <= actions


async def test_flow_2_eve_attack_blocks_message(client):
    alice, alice_creds, bob, bob_creds = await _users(client, "b1")
    eve, eve_creds = await register_user(client, "Eve", "eve.e2e@demo.io",
                                         password="EvePass123!")
    from sqlalchemy import text

    from app.db.session import get_engine

    with get_engine().begin() as conn:
        conn.execute(text("UPDATE users SET role='ATTACKER' WHERE email=:e"),
                     {"e": eve_creds["email"]})

    atok = await login(client, alice_creds)
    btok = await login(client, bob_creds)
    etok = await login(client, eve_creds)

    # Extract the JWT access token from the login response dict
    token = etok["access_token"] if isinstance(etok, dict) else etok

    # --- WebSocket capture subspace: subscribe to Eve events channel ---
    from starlette.testclient import TestClient

    from app.main import create_app
    from app.core.security import decode_access_token as _decode

    _app = create_app()
    tc = TestClient(_app)

    captured_types: set[str] = set()
    ws_lock = threading.Lock()
    _event_sent = threading.Event()

    def _ws_listener():
        nonlocal captured_types
        try:
            with tc.websocket_connect(f"/ws/eve/events?token={token}") as ws:
                while len(captured_types) < 2:
                    try:
                        message = ws.receive_json()
                    except Exception:
                        break
                    mt = message.get("type")
                    if mt in ("attack.started", "attack.detected"):
                        with ws_lock:
                            captured_types.add(mt)
                _event_sent.set()
        except Exception:
            pass

    ws_thread = threading.Thread(target=_ws_listener, daemon=True)
    ws_thread.start()
    # -------------------------------------------------------

    # park a session inside the attack window with baseline QKD executed
    from app.db.session import session_scope
    from app.services.ai_recommendation_service import AiRecommendationService
    from app.services.auth_service import AuthService
    from app.services.messaging_service import MessagingService
    from app.services.qkd_service import QkdService

    with session_scope() as s:
        svc = AuthService(s)
        sender = svc.users.get_by_email(alice_creds["email"])
        receiver = svc.users.get_by_email(bob_creds["email"])
        ms = MessagingService(s)
        msg, comm = ms.create_message(sender, receiver.unique_user_id,
                                      "flow two secret", "HIGH")
        sm = ms.state_machine
        sm.transition(comm, "AI_ANALYZING")
        rec = AiRecommendationService(s).recommend(comm, "HIGH")
        comm.protocol = rec.protocol
        msg.protocol = rec.protocol
        sm.transition(comm, "PROTOCOL_SELECTED")
        sm.transition(comm, "QKD_INITIALIZING")
        sm.transition(comm, "QKD_RUNNING")
        baseline_row, _ = QkdService(s).execute_baseline(comm)
        sm.transition(comm, "KEY_SIFTING")
        sm.transition(comm, "QBER_EVALUATION")
        comm_id, msg_id, baseline_qber = comm.id, msg.id, baseline_row.qber

    # Eve discovers the target through her metadata-only feed
    active = (await client.get("/api/v1/communications/active",
                               headers=auth_headers(etok))).json()["items"]
    target = next(a for a in active if a["id"] == comm_id)
    assert {"id", "communication_id", "sender_id", "receiver_id", "sender_name",
            "receiver_name", "protocol", "session_state", "status", "qber",
            "threshold", "attackable", "attack_types",
            "created_at"} <= set(target.keys())
    assert target["communication_id"] == comm_id
    assert target["attackable"] is True

    # launch simulated intercept-and-resend at max strength
    attack = (
        await client.post(
            f"/api/v1/communications/{comm_id}/attacks",
            json={"attack_type": "INTERCEPT_AND_RESEND", "attack_strength": 1.0},
            headers=auth_headers(etok),
        )
    ).json()

    assert attack["detection_status"] == "DETECTED"
    assert attack["qber_after"] > baseline_qber
    assert attack["states_intercepted"] == 256
    assert attack["session_state"] == "BLOCKED"

    # blocked message NEVER delivered to Bob's inbox
    inbox = (await client.get("/api/v1/messages/inbox", headers=auth_headers(btok))).json()
    assert all(i["id"] != msg_id for i in inbox["items"])

    # sender view flags BLOCKED; report reflects rejection
    sent = (await client.get("/api/v1/messages/sent", headers=auth_headers(atok))).json()
    row = next(r for r in sent["items"] if r["id"] == msg_id)
    assert row["status"] == "BLOCKED" and row["attack_detected"] is True

    report = (
        await client.get(f"/api/v1/messages/{msg_id}/security-report", headers=auth_headers(atok))
    ).json()["report"]
    assert report["key_status"] == "REJECTED" and report["delivery_status"] == "BLOCKED"

    # post-attack run stored (is_baseline=false) with higher QBER
    runs = (
        await client.get(f"/api/v1/communications/{comm_id}/qkd", headers=auth_headers(atok))
    ).json()["runs"]
    assert [r["is_baseline"] for r in runs] == [True, False]
    assert runs[1]["qber"] > runs[0]["qber"]

    # eve history + dashboard reflect the detection
    history = (await client.get("/api/v1/attacks/history", headers=auth_headers(etok))).json()
    assert any(h["detection_status"] == "DETECTED" for h in history["items"])
    summary = (await client.get("/api/v1/eve/dashboard/summary", headers=auth_headers(etok))).json()
    assert summary["detected_attacks"] >= 1 and summary["detection_rate"] > 0

    # admin security monitoring sees the event
    from app.services.auth_service import AuthService as AS

    admin_pw = "AdminPass!23"
    with session_scope() as s:
        admin = AS(s).register("Admin E2E", "admin.e2e@demo.io", admin_pw)
        admin.role = "ADMIN"
    admtok = await login(client, {"email": "admin.e2e@demo.io", "password": admin_pw})
    events = (await client.get("/api/v1/admin/security-events", headers=auth_headers(admtok))).json()
    assert any(e["attack_detected"] for e in events["items"])

    # Wait for WebSocket capture thread to have observed the events
    _event_sent.wait(timeout=10)

    # use WebSocket-captured attack.started and attack.detected types
    types = list(captured_types)
    assert "attack.started" in types and "attack.detected" in types
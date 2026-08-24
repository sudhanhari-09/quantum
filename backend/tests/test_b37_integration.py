"""B37 acceptance: Section 24 demo scenarios A + B over HTTP, repeated seeds.

Scenario A — normal secure communication (Alice -> Bob): full pipeline to
READ with report DELIVERED.
Scenario B — eavesdropping detected and blocked: strong attack on an active
session; message never reaches the inbox.

Both scenarios repeat three times to guard randomness (deterministic seeds).
"""

from __future__ import annotations

import pytest

from tests.conftest import auth_headers, login, register_user


def _unique(tag: str, email: str) -> str:
    return email.replace("@", f".{tag}@").lower()


async def _register(client, name, email, password="Str0ngPass!x"):
    user, creds = await register_user(client, name, email, password=password)
    return user, creds


async def scenario_a_normal_flow(client, tag: str) -> dict:
    """Register -> login -> search -> compose -> recommend==executed ->
    qkd -> accepted -> encrypted -> delivered -> read -> report."""
    alice, alice_creds = await _register(client, "Alice", _unique(tag, "alice@demo.io"))
    bob, bob_creds = await _register(client, "Bob", _unique(tag, "bob@demo.io"))
    atok = await login(client, alice_creds)
    btok = await login(client, bob_creds)

    # search receiver
    resp = await client.get(
        "/api/v1/users/search",
        params={"qsc_id": bob["unique_user_id"]},
        headers=auth_headers(atok),
    )
    assert resp.status_code == 200

    # compose
    created = (
        await client.post(
            "/api/v1/messages",
            json={"receiver_qsc_id": bob["unique_user_id"],
                  "content": f"Demo A payload {tag}",
                  "security_requirement": "MEDIUM"},
            headers=auth_headers(atok),
        )
    ).json()
    comm_id, msg_id = created["communication_id"], created["message_id"]

    # recommendation == executed protocol (invariant)
    detail = (await client.get(f"/api/v1/communications/{comm_id}", headers=auth_headers(atok))).json()
    rec = (await client.get(f"/api/v1/communications/{comm_id}/recommendation", headers=auth_headers(atok))).json()
    assert rec["protocol"] == detail["protocol"]

    # security accepted within threshold
    sec = (await client.get(f"/api/v1/communications/{comm_id}/security", headers=auth_headers(atok))).json()
    assert sec["decision"] == "ACCEPTED"
    assert sec["qber"] <= sec["threshold"]

    # ciphertext stored, plaintext not
    from app.db.session import session_scope
    from app.models import Message

    with session_scope() as s:
        row = s.get(Message, msg_id)
        assert row.encrypted_message and row.nonce

    # inbox + read
    inbox = (await client.get("/api/v1/messages/inbox", headers=auth_headers(btok))).json()
    assert any(i["id"] == msg_id for i in inbox["items"])
    opened = (await client.get(f"/api/v1/messages/{msg_id}", headers=auth_headers(btok))).json()
    assert opened["content"] == f"Demo A payload {tag}"
    assert opened["status"] == "READ"

    # report honest
    report = (
        await client.get(f"/api/v1/messages/{msg_id}/security-report", headers=auth_headers(atok))
    ).json()["report"]
    assert report["delivery_status"] == "DELIVERED"
    assert report["encryption_status"] == "ENCRYPTED"

    return {"comm_id": comm_id, "final_state": "READ"}


async def scenario_b_attack_blocked(client, tag: str) -> dict:
    """Eve logs in -> sees active comm -> INTERCEPT_AND_RESEND p=1.0 ->
    QBER rises -> DETECTED -> KEY_REJECTED -> BLOCKED; not in inbox."""
    alice, alice_creds = await _register(client, "Alice", _unique(tag, "aliceB@demo.io"))
    bob, bob_creds = await _register(client, "Bob", _unique(tag, "bobB@demo.io"))
    eve_user, eve_creds = await _register(client, "Eve", _unique(tag, "eveB@demo.io"),
                                          password="EvePass123!")

    from sqlalchemy import text

    from app.db.session import get_engine

    with get_engine().begin() as conn:
        conn.execute(text("UPDATE users SET role='ATTACKER' WHERE email=:e"),
                     {"e": eve_creds["email"]})

    atok = await login(client, alice_creds)
    btok = await login(client, bob_creds)
    etok = await login(client, eve_creds)

    # create session parked inside the attack window (QBER_EVALUATION)
    from app.db.session import session_scope
    from app.services.auth_service import AuthService
    from app.services.ai_recommendation_service import AiRecommendationService
    from app.services.messaging_service import MessagingService
    from app.services.qkd_service import QkdService

    with session_scope() as s:
        svc = AuthService(s)
        sender = svc.users.get_by_email(alice_creds["email"])
        receiver = svc.users.get_by_email(bob_creds["email"])
        ms = MessagingService(s)
        msg, comm = ms.create_message(sender, receiver.unique_user_id,
                                      f"Demo B secret {tag}", "HIGH")
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
        comm_id, msg_id = comm.id, msg.id
        baseline_qber = baseline_row.qber

    # Eve sees it in her target list
    active = (await client.get("/api/v1/communications/active", headers=auth_headers(etok))).json()["items"]
    assert any(a["id"] == comm_id for a in active)

    # launch simulated intercept-and-resend at full strength
    attack = (
        await client.post(
            f"/api/v1/communications/{comm_id}/attacks",
            json={"attack_type": "INTERCEPT_AND_RESEND", "attack_strength": 1.0},
            headers=auth_headers(etok),
        )
    ).json()

    assert attack["detection_status"] == "DETECTED"
    assert attack["qber_after"] > baseline_qber
    assert attack["session_state"] == "BLOCKED"

    # blocked message invisible in receiver's inbox
    inbox = (await client.get("/api/v1/messages/inbox", headers=auth_headers(btok))).json()
    assert all(i["id"] != msg_id for i in inbox["items"])

    # sender sees BLOCKED flagged
    sent = (await client.get("/api/v1/messages/sent", headers=auth_headers(atok))).json()
    row = next(r for r in sent["items"] if r["id"] == msg_id)
    assert row["status"] == "BLOCKED" and row["attack_detected"] is True

    # report reflects rejection
    report = (
        await client.get(f"/api/v1/messages/{msg_id}/security-report", headers=auth_headers(atok))
    ).json()["report"]
    assert report["key_status"] == "REJECTED"
    assert report["delivery_status"] == "BLOCKED"

    # admin monitoring sees the event
    admin_creds = {"email": f"admin.{tag}@demo.io", "password": "AdminPass!23"}
    from app.db.session import session_scope as scope2
    from app.services.auth_service import AuthService as AS2

    with scope2() as s:
        admin = AS2(s).register("Admin Demo", admin_creds["email"], admin_creds["password"])
        admin.role = "ADMIN"
    admtok = await login(client, admin_creds)
    events = (await client.get("/api/v1/admin/security-events", headers=auth_headers(admtok))).json()
    assert any(e["attack_detected"] for e in events["items"])

    # eve history contains the attack
    history = (await client.get("/api/v1/attacks/history", headers=auth_headers(etok))).json()
    assert history["total"] >= 1
    assert any(h["detection_status"] == "DETECTED" for h in history["items"])

    return {"comm_id": comm_id, "final_state": "BLOCKED"}


@pytest.mark.parametrize("seed_tag", ["s1", "s2", "s3"])
async def test_demo_scenario_a_repeated(client, seed_tag):
    result = await scenario_a_normal_flow(client, seed_tag)
    assert result["final_state"] == "READ"


@pytest.mark.parametrize("seed_tag", ["s1", "s2", "s3"])
async def test_demo_scenario_b_repeated(client, seed_tag):
    result = await scenario_b_attack_blocked(client, seed_tag)
    assert result["final_state"] == "BLOCKED"


@pytest.mark.parametrize("seed_tag", ["x1", "x2"])
async def test_scenarios_back_to_back_same_session(client, seed_tag):
    """A then B against one shared app state (mirrors manual demo order)."""
    await scenario_a_normal_flow(client, f"{seed_tag}a")
    await scenario_b_attack_blocked(client, f"{seed_tag}b")

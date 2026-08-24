"""B22/B23/B24/B25/B29 acceptance: simulated eavesdropping end-to-end.

Scenario B (Section 24): eve logs in -> sees active session -> launches
INTERCEPT_AND_RESEND -> QBER genuinely rises (stored rerun) -> DETECTED ->
KEY_REJECTED -> BLOCKED -> never in receiver inbox; eve history complete.
"""

from __future__ import annotations

import pytest

from tests.conftest import auth_headers, login, register_user


async def _promote_attacker(client, creds):
    from app.db.session import get_engine
    from sqlalchemy import text

    with get_engine().begin() as conn:
        conn.execute(
            text("UPDATE users SET role='ATTACKER' WHERE email=:e"),
            {"e": creds["email"]},
        )


async def _make_admin(client):
    from app.db.session import get_engine
    from sqlalchemy import text

    from app.services.auth_service import AuthService
    from app.db.session import session_scope

    with session_scope() as s:
        svc = AuthService(s)
        admin = svc.register("Admin B", "admin.b24@test.io", "AdminPass!23")
        admin.role = "ADMIN"
        s.flush()
    return {"email": "admin.b24@test.io", "password": "AdminPass!23"}


async def _start_communication(client):
    """Alice sends to Bob; pipeline runs; but attack window needs an open state.

    The full POST /messages pipeline runs synchronously to DELIVERED, so for
    attack-window tests we create a session and pause it mid-pipeline by
    driving services directly.
    """
    alice_user, alice_creds = await register_user(client, "Alice", "alice.atk@test.io")
    bob_user, bob_creds = await register_user(client, "Bob", "bob.atk@test.io")
    atok = await login(client, alice_creds)

    # Create message + session only (no pipeline) so the window stays open.
    from app.db.session import session_scope
    from app.models import Message
    from app.services.auth_service import AuthService
    from app.services.messaging_service import MessagingService

    with session_scope() as s:
        sender = AuthService(s).users.get_by_email(alice_creds["email"])
        receiver = AuthService(s).users.get_by_email(bob_creds["email"])
        ms = MessagingService(s)
        msg, comm = ms.create_message(sender, receiver.unique_user_id, "secret payload",
                                      "MEDIUM")
        # Walk into the attack window (QKD_RUNNING).
        sm = ms.state_machine
        for st in ("AI_ANALYZING",):
            sm.transition(comm, st)
        from app.services.ai_recommendation_service import AiRecommendationService

        rec = AiRecommendationService(s).recommend(comm, "MEDIUM")
        comm.protocol = rec.protocol
        msg.protocol = rec.protocol
        sm.transition(comm, "PROTOCOL_SELECTED")
        sm.transition(comm, "QKD_INITIALIZING")
        sm.transition(comm, "QKD_RUNNING")
        # Execute + persist the baseline run but stop before SECURITY_CHECK
        # so the session remains inside the attack window.
        from app.services.qkd_service import QkdService

        qkd = QkdService(s)
        baseline_row, _result = qkd.execute_baseline(comm)
        sm.transition(comm, "KEY_SIFTING")
        sm.transition(comm, "QBER_EVALUATION")
        return {
            "comm_id": comm.id,
            "msg_id": msg.id,
            "baseline_qber": baseline_row.qber,
            "alice": alice_creds,
            "bob": bob_creds,
        }


async def test_eve_role_boundary_on_active_list(client):
    ctx = await _start_communication(client)
    eve_user, eve_creds = await register_user(client, "Eve", "eve.b22@test.io",
                                              password="EvePass123!")
    await _promote_attacker(client, eve_creds)
    eve_tokens = await login(client, eve_creds)

    resp = await client.get("/api/v1/communications/active", headers=auth_headers(eve_tokens))
    assert resp.status_code == 200
    items = resp.json()["items"]
    target = next((i for i in items if i["id"] == ctx["comm_id"]), None)
    assert target is not None
    # metadata-only visibility per Section 14.3
    assert set(target.keys()) == {"id", "sender_name", "receiver_name", "protocol",
                                  "session_state", "created_at"}
    assert "ciphertext" not in str(items).lower()

    # a plain USER must be denied the attacker list
    alice_tokens = await login(client, ctx["alice"])
    resp = await client.get("/api/v1/communications/active", headers=auth_headers(alice_tokens))
    assert resp.status_code == 403


async def test_attack_detected_blocks_message(client):
    ctx = await _start_communication(client)
    eve_user, eve_creds = await register_user(client, "Eve2", "eve.b24@test.io",
                                              password="EvePass123!")
    await _promote_attacker(client, eve_creds)
    eve_tokens = await login(client, eve_creds)
    _, bob_tokens = None, await login(client, ctx["bob"])

    # launch strong attack (p=1.0 -> expected QBER jump ~ +0.25)
    resp = await client.post(
        f"/api/v1/communications/{ctx['comm_id']}/attacks",
        json={"attack_type": "INTERCEPT_AND_RESEND", "attack_strength": 1.0},
        headers=auth_headers(eve_tokens),
    )
    assert resp.status_code == 201, resp.text
    attack = resp.json()
    assert attack["detection_status"] == "DETECTED"
    assert attack["qber_after"] > attack["qber_before"]
    assert attack["states_intercepted"] == 256  # p=1.0 * default qubits
    assert attack["session_state"] == "BLOCKED"

    # message blocked; not in inbox as delivered
    inbox = (await client.get("/api/v1/messages/inbox", headers=auth_headers(bob_tokens))).json()
    assert all(item["id"] != ctx["msg_id"] for item in inbox["items"])

    # sender's sent view DOES show it flagged BLOCKED
    alice_tokens = await login(client, ctx["alice"])
    sent = (await client.get("/api/v1/messages/sent", headers=auth_headers(alice_tokens))).json()
    row = next(r for r in sent["items"] if r["id"] == ctx["msg_id"])
    assert row["status"] == "BLOCKED"
    assert row["attack_detected"] is True

    # security report exists with REJECTED key status
    report = (
        await client.get(f"/api/v1/messages/{ctx['msg_id']}/security-report",
                         headers=auth_headers(alice_tokens))
    ).json()["report"]
    assert report["key_status"] == "REJECTED"
    assert report["delivery_status"] == "BLOCKED"
    assert report["attack_detected"] is True

    # no secret key persisted on rejected path
    from app.db.session import session_scope
    from app.models import SecretKey

    with session_scope() as s:
        count = (
            s.query(SecretKey)
            .filter(SecretKey.communication_id == ctx["comm_id"])
            .count()
        )
        assert count == 0

    # post-attack run stored with is_baseline=False
    qkd = (
        await client.get(f"/api/v1/communications/{ctx['comm_id']}/qkd",
                         headers=auth_headers(alice_tokens))
    ).json()
    assert len(qkd["runs"]) == 2
    assert [r["is_baseline"] for r in qkd["runs"]] == [True, False]
    assert qkd["runs"][1]["qber"] > qkd["runs"][0]["qber"]

    # plaintext was never stored anywhere
    from app.db.session import session_scope
    from app.models import Message

    with session_scope() as s:
        msg = s.get(Message, ctx["msg_id"])
        assert msg.encrypted_message is None  # never encrypted (blocked path)


async def test_reattack_cap_and_window_closed(client):
    """MAX_REATTACKS applies to re-attacks on sessions still in the window.

    Weak (p=0.1) attacks go undetected -> the session stays in QBER_EVALUATION
    and remains attackable until MAX_REATTACKS=3 total attempts. A DETECTED
    attack, by contrast, blocks the session instantly (window closed).
    """
    ctx = await _start_communication(client)
    eve_user, eve_creds = await register_user(client, "Eve3", "eve.b25b@test.io",
                                              password="EvePass123!")
    await _promote_attacker(client, eve_creds)
    eve_tokens = await login(client, eve_creds)

    url = f"/api/v1/communications/{ctx['comm_id']}/attacks"
    weak_body = {"attack_type": "INTERCEPT_AND_RESEND", "attack_strength": 0.1}

    for i in range(3):  # three undetected re-attacks allowed
        resp = await client.post(url, json=weak_body, headers=auth_headers(eve_tokens))
        assert resp.status_code == 201, f"attack {i+1}: {resp.text}"
        assert resp.json()["detection_status"] == "NOT_DETECTED"
        assert resp.json()["session_state"] == "QBER_EVALUATION"

    # 4th attempt hits the MAX_REATTACKS guard
    resp = await client.post(url, json=weak_body, headers=auth_headers(eve_tokens))
    assert resp.status_code == 409
    assert resp.json()["code"] == "ATTACK_WINDOW_CLOSED"


async def test_detected_attack_instantly_closes_window(client):
    ctx = await _start_communication(client)
    eve_user, eve_creds = await register_user(client, "Eve3b", "eve.b25c@test.io",
                                              password="EvePass123!")
    await _promote_attacker(client, eve_creds)
    eve_tokens = await login(client, eve_creds)

    url = f"/api/v1/communications/{ctx['comm_id']}/attacks"
    strong = {"attack_type": "INTERCEPT_AND_RESEND", "attack_strength": 1.0}

    resp = await client.post(url, json=strong, headers=auth_headers(eve_tokens))
    assert resp.status_code == 201 and resp.json()["detection_status"] == "DETECTED"

    # Session is BLOCKED now; any further attack is window-closed.
    resp = await client.post(url, json=strong, headers=auth_headers(eve_tokens))
    assert resp.status_code == 409
    assert resp.json()["code"] == "ATTACK_WINDOW_CLOSED"


async def test_weak_attack_may_go_undetected_and_session_resumes(client):
    ctx = await _start_communication(client)
    eve_user, eve_creds = await register_user(client, "Eve4", "eve.b24b@test.io",
                                              password="EvePass123!")
    await _promote_attacker(client, eve_creds)
    eve_tokens = await login(client, eve_creds)

    resp = await client.post(
        f"/api/v1/communications/{ctx['comm_id']}/attacks",
        json={"attack_type": "INTERCEPT_AND_RESEND", "attack_strength": 0.1},
        headers=auth_headers(eve_tokens),
    )
    assert resp.status_code == 201
    result = resp.json()
    # weak attack recorded either way; NOT_DETECTED leaves session in window
    assert result["detection_status"] in ("DETECTED", "NOT_DETECTED")
    assert result["qber_after"] >= result["qber_before"]

    history = (await client.get("/api/v1/attacks/history", headers=auth_headers(eve_tokens))).json()
    assert history["total"] >= 1
    assert all(a["communication_id"] is not None for a in history["items"])


async def test_eve_history_scoped_to_own_attacks(client):
    ctx = await _start_communication(client)
    e1_user, e1_creds = await register_user(client, "EveA", "eve.a@test.io", password="EvePass123!")
    e2_user, e2_creds = await register_user(client, "EveB", "eve.b@test.io", password="EvePass123!")
    await _promote_attacker(client, e1_creds)
    await _promote_attacker(client, e2_creds)
    t1 = await login(client, e1_creds)
    t2 = await login(client, e2_creds)

    body = {"attack_type": "INTERCEPT_AND_RESEND", "attack_strength": 1.0}
    url = f"/api/v1/communications/{ctx['comm_id']}/attacks"
    await client.post(url, json=body, headers=auth_headers(t1))  # eve A attacks

    hist1 = (await client.get("/api/v1/attacks/history", headers=auth_headers(t1))).json()
    hist2 = (await client.get("/api/v1/attacks/history", headers=auth_headers(t2))).json()
    assert hist1["total"] == 1
    assert hist2["total"] == 0  # B cannot see A's attacks

    # eve summary reflects counts live
    summary = (await client.get("/api/v1/eve/dashboard/summary", headers=auth_headers(t1))).json()
    assert set(summary.keys()) == {"active_sessions", "total_attacks",
                                   "detected_attacks", "detection_rate"}


async def test_attack_requires_attacker_role(client):
    ctx = await _start_communication(client)
    alice_tokens = await login(client, ctx["alice"])
    resp = await client.post(
        f"/api/v1/communications/{ctx['comm_id']}/attacks",
        json={"attack_type": "INTERCEPT_AND_RESEND", "attack_strength": 0.5},
        headers=auth_headers(alice_tokens),
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "ROLE_FORBIDDEN"


async def test_invalid_attack_type_yields_contract_code(client):
    ctx = await _start_communication(client)
    eve_user, eve_creds = await register_user(client, "Eve6", "eve.b23t@test.io",
                                              password="EvePass123!")
    await _promote_attacker(client, eve_creds)
    eve_tokens = await login(client, eve_creds)

    resp = await client.post(
        f"/api/v1/communications/{ctx['comm_id']}/attacks",
        json={"attack_type": "DDOS", "attack_strength": 0.5},
        headers=auth_headers(eve_tokens),
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "INVALID_ATTACK_TYPE"


async def test_invalid_strength_rejected(client):
    ctx = await _start_communication(client)
    eve_user, eve_creds = await register_user(client, "Eve5", "eve.b23v@test.io",
                                              password="EvePass123!")
    await _promote_attacker(client, eve_creds)
    eve_tokens = await login(client, eve_creds)

    resp = await client.post(
        f"/api/v1/communications/{ctx['comm_id']}/attacks",
        json={"attack_type": "INTERCEPT_AND_RESEND", "attack_strength": 0.05},  # < 0.1
        headers=auth_headers(eve_tokens),
    )
    assert resp.status_code == 422

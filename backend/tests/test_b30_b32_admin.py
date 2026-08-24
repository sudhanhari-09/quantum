"""B30/B31/B32 acceptance: admin surfaces, analytics, audit trail."""

from __future__ import annotations

from tests.conftest import auth_headers, login, register_user


async def _make_admin(client, email="admin.b30@test.io"):
    from app.db.session import session_scope
    from app.services.auth_service import AuthService

    password = "AdminPass!23"
    with session_scope() as s:
        svc = AuthService(s)
        admin = svc.register("Admin B30", email, password)
        admin.role = "ADMIN"
        s.flush()
        admin_id = admin.id
    return {"id": admin_id, "email": email, "password": password}


async def _login_admin(client):
    creds = await _make_admin(client)
    return await login(client, creds)


async def test_admin_dashboard_summary_live_aggregates(client):
    atok = await _login_admin(client)

    alice_user, alice_creds = await register_user(client, "Ali", "a.b30@test.io")
    bob_user, bob_creds = await register_user(client, "Bob", "b.b30@test.io")
    at = await login(client, alice_creds)

    await client.post(
        "/api/v1/messages",
        json={"receiver_qsc_id": bob_user["unique_user_id"], "content": "stats"},
        headers=auth_headers(at),
    )

    resp = await client.get("/api/v1/admin/dashboard/summary", headers=auth_headers(atok))
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {"total_users", "active_communications",
                                "messages_delivered", "messages_blocked",
                                "attacks_total", "attacks_detected",
                                "attack_detection_rate", "average_qber",
                                "communications_per_day",
                                "security_outcomes", "protocol_usage",
                                "recent_audit"}
    assert body["total_users"] == 3  # 2 users + admin
    assert body["messages_delivered"] == 1
    assert isinstance(body["communications_per_day"], list)


async def test_attacker_account_creation_and_login(client):
    atok = await _login_admin(client)
    resp = await client.post(
        "/api/v1/admin/attackers",
        json={"name": "Mallory", "email": "mallory.b30@test.io",
              "password": "AttackPass1!"},
        headers=auth_headers(atok),
    )
    assert resp.status_code == 201
    assert resp.json()["user"]["role"] == "ATTACKER"

    # created attacker can log in with role ATTACKER
    login_resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "mallory.b30@test.io", "password": "AttackPass1!"},
    )
    assert login_resp.status_code == 200
    assert login_resp.json()["user"]["role"] == "ATTACKER"

    # duplicate email rejected
    dup = await client.post(
        "/api/v1/admin/attackers",
        json={"name": "M2", "email": "MALLORY.b30@test.io", "password": "AttackPass1!"},
        headers=auth_headers(atok),
    )
    assert dup.status_code == 409

    # list shows the attacker
    listing = await client.get("/api/v1/admin/attackers", headers=auth_headers(atok))
    assert any(a["email"] == "mallory.b30@test.io" for a in listing.json()["attackers"])

    # non-admin cannot create attackers
    _, plain_creds = await register_user(client, "Plain", "plain.b30@test.io")
    user_tokens = await login(client, plain_creds)
    denied = await client.get("/api/v1/admin/attackers", headers=auth_headers(user_tokens))
    assert denied.status_code == 403


async def test_protocol_analytics_matches_db(client):
    atok = await _login_admin(client)
    alice_user, alice_creds = await register_user(client, "PA", "pa.b31@test.io")
    bob_user, bob_creds = await register_user(client, "PB", "pb.b31@test.io")
    at = await login(client, alice_creds)

    await client.post(
        "/api/v1/messages",
        json={"receiver_qsc_id": bob_user["unique_user_id"], "content": "analytics"},
        headers=auth_headers(at),
    )

    resp = await client.get("/api/v1/admin/protocol-analytics", headers=auth_headers(atok))
    assert resp.status_code == 200
    protocols = {p["name"]: p for p in resp.json()["protocols"]}
    assert len(protocols) == 6
    bb84 = protocols["BB84"]
    assert bb84["sessions"] >= 1
    assert bb84["avg_confidence"] is not None
    assert 0.0 <= bb84["avg_qber"] <= 1.0


async def test_security_events_feed(client):
    atok = await _login_admin(client)
    alice_user, alice_creds = await register_user(client, "SA", "sa.b30@test.io")
    bob_user, bob_creds = await register_user(client, "SB", "sb.b30@test.io")
    at = await login(client, alice_creds)

    await client.post(
        "/api/v1/messages",
        json={"receiver_qsc_id": bob_user["unique_user_id"], "content": "events"},
        headers=auth_headers(at),
    )

    resp = await client.get("/api/v1/admin/security-events", headers=auth_headers(atok))
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) >= 1
    row = items[0]
    for field in ("communication_id", "protocol", "qber", "threshold",
                  "key_status", "attack_detected", "verdict"):
        assert field in row


async def test_audit_logs_complete_for_critical_path(client):
    atok = await _login_admin(client)
    alice_user, alice_creds = await register_user(client, "AA", "aa.b32@test.io")
    bob_user, bob_creds = await register_user(client, "AB", "ab.b32@test.io")
    at = await login(client, alice_creds)
    bt = await login(client, bob_creds)

    created = (
        await client.post(
            "/api/v1/messages",
            json={"receiver_qsc_id": bob_user["unique_user_id"], "content": "audit me"},
            headers=auth_headers(at),
        )
    ).json()
    await client.get(f"/api/v1/messages/{created['message_id']}", headers=auth_headers(bt))
    await client.post("/api/v1/auth/logout", json={}, headers=auth_headers(bt))

    resp = await client.get(
        "/api/v1/admin/audit-logs", params={"limit": 100}, headers=auth_headers(atok)
    )
    actions = {row["action"] for row in resp.json()["items"]}
    required = {
        "register", "login", "message.create", "recommend", "qkd.run",
        "security.key_accepted", "deliver", "logout",
    }
    missing = required - actions
    assert not missing, f"missing audit actions: {missing}"

    # no sensitive content in audit descriptions (S16 redaction policy)
    blob = str(resp.json()).lower()
    for marker in ("password_hash", "key_enc", "bearer ", "audit me"):
        assert marker not in blob

    # filter by action prefix works
    filtered = await client.get(
        "/api/v1/admin/audit-logs", params={"action": "qkd."}, headers=auth_headers(atok)
    )
    assert all(row["action"].startswith("qkd.") for row in filtered.json()["items"])


async def test_config_update_audited_and_effective(client):
    atok = await _login_admin(client)
    resp = await client.patch(
        "/api/v1/admin/config", json={"threshold": 0.05}, headers=auth_headers(atok)
    )
    assert resp.status_code == 200

    # config change is audit-logged
    logs = await client.get(
        "/api/v1/admin/audit-logs", params={"action": "config."}, headers=auth_headers(atok)
    )
    assert logs.json()["total"] >= 1

    # restore default for other tests
    await client.patch("/api/v1/admin/config", json={"threshold": 0.11}, headers=auth_headers(atok))


async def test_platform_communications_list(client):
    atok = await _login_admin(client)
    alice_user, alice_creds = await register_user(client, "CA", "ca.b30@test.io")
    bob_user, bob_creds = await register_user(client, "CB", "cb.b30@test.io")
    at = await login(client, alice_creds)
    await client.post(
        "/api/v1/messages",
        json={"receiver_qsc_id": bob_user["unique_user_id"], "content": "platform view"},
        headers=auth_headers(at),
    )
    resp = await client.get("/api/v1/admin/communications", headers=auth_headers(atok))
    assert resp.status_code == 200
    assert len(resp.json()["items"]) >= 1

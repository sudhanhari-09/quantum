"""B7/B8/B10 acceptance: role matrix, ownership, search, admin user mgmt."""

from __future__ import annotations

from tests.conftest import auth_headers, login, register_user


async def _make_admin(client):
    # Bootstrap an admin directly through the service layer (no public API).
    from app.db.session import session_scope
    from app.services.auth_service import AuthService

    with session_scope() as s:
        svc = AuthService(s)
        admin = svc.register("Root Admin", "admin.b7@test.io", "AdminPass!23")
        admin.role = "ADMIN"
        s.flush()
        return {"id": admin.id, "email": "admin.b7@test.io", "password": "AdminPass!23"}


async def test_search_found_notfound_invalid(client):
    alice_user, alice_creds = await register_user(client, "Alice", "alice.b10@test.io")
    _, bob_creds = await register_user(client, "Bob", "bob.b10@test.io")
    bob_tokens = await login(client, bob_creds)

    # found
    resp = await client.get(
        "/api/v1/users/search",
        params={"qsc_id": alice_user["unique_user_id"]},
        headers=auth_headers(bob_tokens),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["user"]["name"] == "Alice"
    assert body["user"]["unique_user_id"] == alice_user["unique_user_id"]
    assert set(body["user"].keys()) == {"id", "name", "unique_user_id", "role"}
    assert "email" not in body["user"]  # public profile only

    # not found
    resp = await client.get(
        "/api/v1/users/search", params={"qsc_id": "QSC-ZZZZZZZZZZ"}, headers=auth_headers(bob_tokens)
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "USER_NOT_FOUND"

    # invalid format
    resp = await client.get(
        "/api/v1/users/search", params={"qsc_id": "NOT-A-QSC-ID"}, headers=auth_headers(bob_tokens)
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "INVALID_QSC_FORMAT"

    # requires auth
    resp = await client.get("/api/v1/users/search", params={"qsc_id": alice_user["unique_user_id"]})
    assert resp.status_code == 401


async def test_role_matrix_attacker_cannot_search_or_manage(client):
    attacker_user, attacker_creds = await register_user(
        client, "Eve B7", "eve.b7@test.io", password="AttackerPass1"
    )
    # promote to ATTACKER via service
    from app.db.session import session_scope
    from app.repositories.user_repository import UserRepository

    with session_scope() as s:
        UserRepository(s).get_by_email(attacker_creds["email"]).role = "ATTACKER"

    tokens = await login(client, attacker_creds)
    h = auth_headers(tokens)

    resp = await client.get("/api/v1/users/search", params={"qsc_id": "QSC-AAAAAAAAA1"}, headers=h)
    assert resp.status_code == 403
    assert resp.json()["code"] == "ROLE_FORBIDDEN"

    resp = await client.get("/api/v1/admin/users", headers=h)
    assert resp.status_code == 403

    resp = await client.patch("/api/v1/admin/users/1", json={"is_active": False}, headers=h)
    assert resp.status_code == 403


async def test_profile_get_and_patch(client):
    _, creds = await register_user(client, "Pam", "pam.b8@test.io")
    tokens = await login(client, creds)
    h = auth_headers(tokens)

    resp = await client.get("/api/v1/users/me", headers=h)
    assert resp.status_code == 200
    assert "email" in resp.json()

    resp = await client.patch("/api/v1/users/me", json={"name": "Pam Renamed"}, headers=h)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Pam Renamed"

    resp = await client.patch("/api/v1/users/me", json={"name": "x"}, headers=h)
    assert resp.status_code == 422


async def test_admin_lists_and_disables_user(client):
    await _make_admin(client)
    admin_tokens = await login(
        client, {"email": "admin.b7@test.io", "password": "AdminPass!23"}
    )
    ah = auth_headers(admin_tokens)

    victim, vcreds = await register_user(client, "Victim", "victim.b8@test.io")
    resp = await client.get("/api/v1/admin/users", params={"search": "Victim"}, headers=ah)
    assert resp.status_code == 200
    listing = resp.json()
    assert listing["total"] == 1
    row = listing["items"][0]
    assert "password_hash" not in row
    assert "password" not in row

    resp = await client.patch(f"/api/v1/admin/users/{victim['id']}", json={"is_active": False}, headers=ah)
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False

    # disabled login -> USER_DISABLED
    resp = await client.post(
        "/api/v1/auth/login", json={"email": vcreds["email"], "password": vcreds["password"]}
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "USER_DISABLED"

    # history rows preserved: re-enable works
    resp = await client.patch(f"/api/v1/admin/users/{victim['id']}", json={"is_active": True}, headers=ah)
    assert resp.status_code == 200


async def test_admin_cannot_disable_self(client):
    await _make_admin(client)
    admin_tokens = await login(
        client, {"email": "admin.b7@test.io", "password": "AdminPass!23"}
    )
    me = (await client.get("/api/v1/auth/me", headers=auth_headers(admin_tokens))).json()["user"]
    resp = await client.patch(
        f"/api/v1/admin/users/{me['id']}", json={"is_active": False}, headers=auth_headers(admin_tokens)
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "ADMIN_CANNOT_DISABLE_SELF"


async def test_user_cannot_access_admin_endpoints(client):
    _, creds = await register_user(client, "Plain", "plain.b7@test.io")
    tokens = await login(client, creds)
    resp = await client.get("/api/v1/admin/users", headers=auth_headers(tokens))
    assert resp.status_code == 403

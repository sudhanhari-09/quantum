"""B11/B12/B15/B20/B26 acceptance: secure pipeline over HTTP.

Scenario A (Section 24): register -> login -> search -> compose ->
recommendation == executed protocol -> QKD -> QBER <= threshold -> accepted
-> encrypted -> delivered -> read -> report exists.
"""

from __future__ import annotations

import asyncio

from tests.conftest import auth_headers, login, register_user


async def _setup_two_users(client):
    alice_user, alice_creds = await register_user(client, "Alice", "alice.pipe@test.io")
    bob_user, bob_creds = await register_user(client, "Bob", "bob.pipe@test.io")
    alice_tokens = await login(client, alice_creds)
    bob_tokens = await login(client, bob_creds)
    return alice_user, bob_user, alice_tokens, bob_tokens


async def test_full_secure_delivery_pipeline(client):
    alice, bob, atok, btok = await _setup_two_users(client)

    # search receiver by QSC ID
    resp = await client.get(
        "/api/v1/users/search",
        params={"qsc_id": bob["unique_user_id"]},
        headers=auth_headers(atok),
    )
    assert resp.status_code == 200

    # compose + send (full pipeline runs synchronously)
    resp = await client.post(
        "/api/v1/messages",
        json={
            "receiver_qsc_id": bob["unique_user_id"],
            "content": "Hello Bob, quantum-secured hello.",
            "security_requirement": "MEDIUM",
        },
        headers=auth_headers(atok),
    )
    assert resp.status_code == 202, resp.text
    created = resp.json()
    comm_id = created["communication_id"]
    msg_id = created["message_id"]

    # session reached terminal DELIVERED state
    detail = (await client.get(f"/api/v1/communications/{comm_id}", headers=auth_headers(atok))).json()
    assert detail["session_status"] in ("DELIVERED",), detail

    # INVARIANT O6: recommendation == executed protocol
    rec = (await client.get(f"/api/v1/communications/{comm_id}/recommendation", headers=auth_headers(atok))).json()
    assert rec["protocol"] == detail["protocol"] == "BB84"
    assert 0.0 <= rec["confidence"] <= 1.0
    assert isinstance(rec["scores"], dict) and len(rec["scores"]) >= 6
    assert "channel_noise" in rec["features"]

    # QKD run persisted with counters; no key material anywhere
    qkd = (await client.get(f"/api/v1/communications/{comm_id}/qkd", headers=auth_headers(atok))).json()
    assert len(qkd["runs"]) >= 1
    run = qkd["runs"][0]
    for field in ("qubits_generated", "matching_bases", "sifted_bits",
                  "compared_bits", "errors", "qber", "threshold", "is_baseline"):
        assert field in run
    raw = str(qkd)
    assert "key_enc" not in raw and "sifted_key" not in raw

    # QBER within threshold on clean channel
    sec = (await client.get(f"/api/v1/communications/{comm_id}/security", headers=auth_headers(atok))).json()
    assert sec["decision"] == "ACCEPTED"
    assert sec["key_status"] == "ACCEPTED"
    assert sec["qber"] is not None

    # message appears in Bob's inbox only after delivery
    inbox = (await client.get("/api/v1/messages/inbox", headers=auth_headers(btok))).json()
    assert any(item["id"] == msg_id for item in inbox["items"])

    # Bob opens the message -> decrypts -> status becomes READ
    got = (await client.get(f"/api/v1/messages/{msg_id}", headers=auth_headers(btok))).json()
    assert got["content"] == "Hello Bob, quantum-secured hello."
    assert got["status"] in ("READ",)

    # security report exists with honest values
    report = (await client.get(f"/api/v1/messages/{msg_id}/security-report", headers=auth_headers(atok))).json()["report"]
    assert report["delivery_status"] == "DELIVERED"
    assert report["encryption_status"] == "ENCRYPTED"
    assert report["attack_detected"] is False

    # sent list shows the delivered message for Alice
    sent = (await client.get("/api/v1/messages/sent", headers=auth_headers(atok))).json()
    row = next(r for r in sent["items"] if r["id"] == msg_id)
    assert row["status"] == "READ"


async def test_self_delivery_and_unknown_receiver(client):
    alice, _, atok, _ = await _setup_two_users(client)

    resp = await client.post(
        "/api/v1/messages",
        json={"receiver_qsc_id": alice["unique_user_id"], "content": "me"},
        headers=auth_headers(atok),
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "SELF_DELIVERY"

    resp = await client.post(
        "/api/v1/messages",
        json={"receiver_qsc_id": "QSC-ZZZZZZZZZZ", "content": "ghost"},
        headers=auth_headers(atok),
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "USER_NOT_FOUND"


async def test_content_too_long_rejected(client):
    alice, bob, atok, _ = await _setup_two_users(client)
    resp = await client.post(
        "/api/v1/messages",
        json={"receiver_qsc_id": bob["unique_user_id"], "content": "x" * 2001},
        headers=auth_headers(atok),
    )
    assert resp.status_code == 422


async def test_foreign_message_access_denied(client):
    alice, bob, atok, btok = await _setup_two_users(client)
    mallory_user, mallory_creds = await register_user(client, "Mallory", "mallory.pipe@test.io")
    mtok = await login(client, mallory_creds)

    created = (
        await client.post(
            "/api/v1/messages",
            json={"receiver_qsc_id": bob["unique_user_id"], "content": "private"},
            headers=auth_headers(atok),
        )
    ).json()

    resp = await client.get(f"/api/v1/messages/{created['message_id']}", headers=auth_headers(mtok))
    assert resp.status_code == 404  # foreign users get NOT_FOUND (no existence leak)


async def test_communication_lists_scoped_to_owner(client):
    alice, bob, atok, btok = await _setup_two_users(client)
    created = (
        await client.post(
            "/api/v1/messages",
            json={"receiver_qsc_id": bob["unique_user_id"], "content": "scoped"},
            headers=auth_headers(atok),
        )
    ).json()

    mine_alice = (await client.get("/api/v1/communications", params={"scope": "history"}, headers=auth_headers(atok))).json()
    assert any(c["id"] == created["communication_id"] for c in mine_alice["items"])

    other_user, other_creds = await register_user(client, "Oscar", "oscar.pipe@test.io")
    otok = await login(client, other_creds)
    theirs = (await client.get("/api/v1/communications", params={"scope": "mine"}, headers=auth_headers(otok))).json()
    assert all(c["id"] != created["communication_id"] for c in theirs["items"])

"""Integration-contract tests: timeline replay, reports alias, QKD sample,
message-detail communication_id, attack.progress emissions."""

from __future__ import annotations

from tests.conftest import auth_headers, login, register_user


async def _delivered_message(client):
    alice_user, alice_creds = await register_user(client, "Alice", "alice.tl@test.io")
    bob_user, bob_creds = await register_user(client, "Bob", "bob.tl@test.io")
    atok = await login(client, alice_creds)
    btok = await login(client, bob_creds)
    created = (
        await client.post(
            "/api/v1/messages",
            json={"receiver_qsc_id": bob_user["unique_user_id"],
                  "content": "timeline test", "security_requirement": "MEDIUM"},
            headers=auth_headers(atok),
        )
    ).json()
    return {"atok": atok, "btok": btok, **created}


async def test_timeline_replays_full_pipeline(client):
    ctx = await _delivered_message(client)
    resp = await client.get(
        f"/api/v1/communications/{ctx['communication_id']}/timeline",
        headers=auth_headers(ctx["atok"]),
    )
    assert resp.status_code == 200
    events = resp.json()["events"]
    types = [e["type"] for e in events]

    # key pipeline moments are persisted and replayable
    for expected in ("communication.state_changed", "ai.protocol_selected",
                     "qkd.started", "qkd.progress", "qber.calculated",
                     "qkd.completed", "security.key_accepted",
                     "message.encrypted", "message.delivered"):
        assert expected in types, f"missing {expected} in {types}"

    # state transitions carry previous_state
    transitions = [e for e in events if e["type"] == "communication.state_changed"]
    assert transitions[0]["previous_state"] == "CREATED"

    # foreign users denied
    other, other_creds = await register_user(client, "Oscar", "oscar.tl@test.io")
    otok = await login(client, other_creds)
    denied = await client.get(
        f"/api/v1/communications/{ctx['communication_id']}/timeline",
        headers=auth_headers(otok),
    )
    assert denied.status_code == 403


async def test_security_reports_alias_matches_primary(client):
    ctx = await _delivered_message(client)
    primary = await client.get("/api/v1/reports/security", headers=auth_headers(ctx["atok"]))
    alias = await client.get("/api/v1/security-reports", headers=auth_headers(ctx["atok"]))
    assert primary.status_code == alias.status_code == 200
    assert primary.json()["items"] == alias.json()["items"]
    assert len(alias.json()["items"]) == 1


async def test_qkd_sample_served_on_flag_with_wire_bases(client):
    ctx = await _delivered_message(client)
    resp = await client.get(
        f"/api/v1/communications/{ctx['communication_id']}/qkd",
        params={"include_sample": True},
        headers=auth_headers(ctx["atok"]),
    )
    runs = resp.json()["runs"]
    sample = runs[0]["sample"]
    assert 0 < len(sample) <= 32
    row = sample[0]
    assert set(row.keys()) == {"index", "alice_bit", "alice_basis", "bob_basis",
                               "bob_bit", "basis_match", "kept", "error"}
    assert row["alice_basis"] in ("R", "D") and row["bob_basis"] in ("R", "D")

    # without flag: no transcript (metadata only)
    plain = (
        await client.get(f"/api/v1/communications/{ctx['communication_id']}/qkd",
                         headers=auth_headers(ctx["atok"]))
    ).json()
    assert "sample" not in plain["runs"][0]


async def test_message_detail_includes_communication_link(client):
    ctx = await _delivered_message(client)
    got = (
        await client.get(f"/api/v1/messages/{ctx['message_id']}", headers=auth_headers(ctx["btok"]))
    ).json()
    assert got["communication_id"] == ctx["communication_id"]

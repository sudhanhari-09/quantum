"""Live end-to-end proof: USER A -> USER B is visible + targetable to EVE.

Runs against a REAL uvicorn server (requires PROCESS_ASYNC=true so the secure
pipeline stays inside the attack window long enough to observe):

    .\\.venv\\Scripts\\python.exe scripts/eve_active_e2e.py

Flow:
  1. login/register USER A (Alice), USER B (Bob) and EVE (ATTACKER);
  2. EVE opens her WebSocket channel (/ws/eve/events);
  3. Alice sends a secure message to Bob;
  4. poll GET /api/v1/communications/active until the session appears
     (the WS event is captured in parallel - no browser refresh involved);
  5. launch INTERCEPT_AND_RESEND against the REAL communication id;
  6. confirm the real QKD/security pipeline reacted (QBER jump -> DETECTED ->
     BLOCKED -> absent from Bob's inbox).

Prints explicit PASS/FAIL lines for each acceptance criterion.
"""

from __future__ import annotations

import asyncio
import json
import sys
import time

import httpx

BASE = "http://127.0.0.1:8000"
API = f"{BASE}/api/v1"
WS = "ws://127.0.0.1:8000/ws"
ADMIN_PASSWORD = "Admin#12345"


def H(tokens: dict) -> dict:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def check(label: str, ok: bool, extra: str = "") -> None:
    print(f"[{'PASS' if ok else 'FAIL'}] {label}{(' - ' + extra) if extra else ''}")
    if not ok:
        raise SystemExit(1)


async def login(client: httpx.AsyncClient, email: str, password: str):
    return await client.post(f"{API}/auth/login", json={"email": email, "password": password})


async def register(client: httpx.AsyncClient, name: str, email: str,
                   password: str = "Str0ngPass!x"):
    resp = await client.post(
        f"{API}/auth/register", json={"name": name, "email": email, "password": password}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["user"]


async def eve_tokens(client: httpx.AsyncClient) -> dict:
    """Seeded attacker (eve@qsc.dev) or admin-created fallback attacker."""
    resp = await login(client, "eve@qsc.dev", ADMIN_PASSWORD)
    if resp.status_code == 200:
        return resp.json()
    admin = await login(client, "admin@qsc.dev", ADMIN_PASSWORD)
    assert admin.status_code == 200, "no seeded ATTACKER and no ADMIN bootstrap account"
    created = await client.post(
        f"{API}/admin/attackers",
        json={"name": "Eve E2E", "email": "eve.e2e@qsc.dev", "password": "EvePass123!"},
        headers=H(admin.json()),
    )
    assert created.status_code in (200, 201), created.text
    resp = await login(client, "eve.e2e@qsc.dev", "EvePass123!")
    assert resp.status_code == 200, resp.text
    return resp.json()


async def main() -> None:
    from websockets.asyncio.client import connect

    async with httpx.AsyncClient(timeout=15) as client:
        health = await client.get(f"{API}/health")
        check("backend reachable", health.status_code == 200, health.text[:80])

        tag = str(int(time.time()))
        await register(client, "Alice E2E", f"alice.e2e.{tag}@qsc.dev")
        bob = await register(client, "Bob E2E", f"bob.e2e.{tag}@qsc.dev")
        alice_tokens = (await login(client, f"alice.e2e.{tag}@qsc.dev", "Str0ngPass!x")).json()
        bob_tokens = (await login(client, f"bob.e2e.{tag}@qsc.dev", "Str0ngPass!x")).json()
        eve = await eve_tokens(client)
        check("USER A / USER B / EVE authenticated", True)

        events: list[dict] = []

        async def collector() -> None:
            async with connect(f"{WS}/eve/events?token={eve['access_token']}") as ws:
                while True:
                    raw = await ws.recv()
                    message = json.loads(raw)
                    if message.get("action") == "ping":
                        continue
                    events.append(message)

        ws_task = asyncio.create_task(collector())
        await asyncio.sleep(0.6)

        t0 = time.time()
        sent = await client.post(
            f"{API}/messages",
            json={
                "receiver_qsc_id": bob["unique_user_id"],
                "content": "live eve visibility probe",
                "security_requirement": "MEDIUM",
            },
            headers=H(alice_tokens),
        )
        check("USER A -> USER B accepted (202)", sent.status_code == 202, sent.text[:80])
        comm_id = sent.json()["communication_id"]
        msg_id = sent.json()["message_id"]

        # ---- EVE discovers the live session while it is still targetable ----
        target = None
        deadline = time.time() + 20
        while time.time() < deadline:
            listing = await client.get(f"{API}/communications/active", headers=H(eve))
            target = next((i for i in listing.json()["items"] if i["id"] == comm_id), None)
            if target:
                break
            await asyncio.sleep(0.2)

        check("EVE sees USER A -> USER B in Active Communications", target is not None)
        check("real backend communication id exposed", target["communication_id"] == comm_id)
        check("sender/receiver metadata present",
              target["sender_name"] == "Alice E2E" and target["receiver_name"] == "Bob E2E")
        check("targetable state + protocol + QBER + attackability",
              target["attackable"] is True and target["session_state"] in (
                  "QKD_INITIALIZING", "QKD_RUNNING", "KEY_SIFTING",
                  "QBER_EVALUATION", "SECURITY_CHECK") and bool(target["protocol"]),
              f"state={target['session_state']} protocol={target['protocol']} "
              f"qber={target['qber']} after {time.time() - t0:.2f}s")
        flat = str(target).lower()
        check("no plaintext / no key material in EVE payload",
              all(w not in flat for w in ("probe", "sifted", "key_bits", "password")))

        # ---- EVE launches the REAL attack on the REAL id --------------------
        attacked = await client.post(
            f"{API}/communications/{target['communication_id']}/attacks",
            json={"attack_type": "INTERCEPT_AND_RESEND", "attack_strength": 1.0},
            headers=H(eve),
        )
        check("EVE attack accepted on the real session (201)", attacked.status_code == 201,
              attacked.text[:120])
        attack = attacked.json()
        check("attack hit the real QKD pipeline (QBER jump + detection)",
              attack["communication_id"] == comm_id
              and attack["qber_after"] > attack["qber_before"]
              and attack["detection_status"] == "DETECTED",
              f"qber {attack['qber_before']} -> {attack['qber_after']} "
              f"({attack['detection_status']})")

        # ---- terminal state + inbox + live WS evidence ----------------------
        final = None
        deadline = time.time() + 15
        while time.time() < deadline:
            detail = await client.get(f"{API}/communications/{comm_id}", headers=H(alice_tokens))
            final = detail.json()["session_status"]
            if final in ("BLOCKED", "DELIVERED", "READ", "FAILED"):
                break
            await asyncio.sleep(0.3)
        check("blocked communication is terminal", final == "BLOCKED", f"final={final}")

        inbox = await client.get(f"{API}/messages/inbox", headers=H(bob_tokens))
        check("blocked message never reaches USER B's inbox",
              all(m["id"] != msg_id for m in inbox.json()["items"]))

        closed = await client.get(f"{API}/communications/active", headers=H(eve))
        check("session removed from EVE's active list once closed",
              comm_id not in {i["id"] for i in closed.json()["items"]})

        await asyncio.sleep(0.5)
        ws_task.cancel()
        relevant = [e for e in events if e.get("communication_id") == comm_id]
        types = sorted({e["type"] for e in relevant})
        check("EVE socket received live events for this communication (no manual refresh)",
              "communication.state_changed" in types,
              f"types={types}")

        print("\n=== LIVE E2E RESULT: ALL CHECKS PASSED ===")
        print(f"communication_id={comm_id} visible_to_eve_after={time.time() - t0:.2f}s")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - surface any failure for the operator
        print(f"[FAIL] unexpected error: {type(exc).__name__}: {exc}")
        sys.exit(1)


"""LIVE Flow-2 proof: real uvicorn + real WebSocket Eve channel.

PROCESS_ASYNC must be enabled server-side. Executes Section-24 Scenario B
over pure HTTP + WS exactly as the frontend does:
  eve login -> /communications/active (window race) -> INTERCEPT_AND_RESEND
  -> DETECTED -> BLOCKED -> inbox absence -> report REJECTED -> admin feed.
Also captures attack.* frames on /ws/eve/events.
"""

import asyncio
import json
import os

import httpx

PORT = int(os.environ.get("QSC_PORT", "8000"))
BASE = f"http://127.0.0.1:{PORT}/api/v1"
WS_EVE = f"ws://127.0.0.1:{PORT}/ws/eve/events"

frames: list[dict] = []


async def capture(token: str) -> None:
    import websockets

    try:
        async with websockets.connect(f"{WS_EVE}?token={token}", max_size=None) as ws:
            while len(frames) == 0 or frames[-1].get("type") != "__done__":
                try:
                    frame = await asyncio.wait_for(ws.recv(), timeout=0.4)
                except asyncio.TimeoutError:
                    continue
                except Exception:
                    break
                try:
                    frames.append(json.loads(frame))
                    if frames[-1].get("type") == "message.blocked":
                        frames.append({"type": "__done__"})
                except Exception:
                    pass
    except Exception as exc:  # noqa: BLE001
        print("eve socket ended:", type(exc).__name__)


async def _ensure_user(c: httpx.AsyncClient, name: str, email: str, password: str) -> None:
    r = await c.post(f"{BASE}/auth/register", json={
        "name": name, "email": email, "password": password})
    assert r.status_code in (201, 409), f"register {email}: {r.status_code} {r.text}"


async def main() -> int:
    async with httpx.AsyncClient(timeout=30) as c:
        # users (idempotent across reruns)
        await _ensure_user(c, "Alice F2", "alice.f2@demo.io", "Str0ngPass!x")
        await _ensure_user(c, "Bob F2", "bob.f2@demo.io", "Str0ngPass!x")
        await _ensure_user(c, "Eve F2", "eve.f2@demo.io", "EvePass123!")
        # promote eve via direct DB (bootstrap path parity with frontend seeding)
        from sqlalchemy import create_engine, text
        db = os.environ.get("LIVE_DB", "qsc.db").replace("\\", "/")
        eng = create_engine(f"sqlite:///{db}")
        with eng.begin() as conn:
            conn.execute(text("UPDATE users SET role='ATTACKER' WHERE email='eve.f2@demo.io'"))
        eng.dispose()

        bob_login = (await c.post(f"{BASE}/auth/login", json={
            "email": "bob.f2@demo.io", "password": "Str0ngPass!x"})).json()
        btok = bob_login["access_token"]
        bob = bob_login["user"]
        etok = (await c.post(f"{BASE}/auth/login", json={
            "email": "eve.f2@demo.io", "password": "EvePass123!"})).json()["access_token"]
        atok = (await c.post(f"{BASE}/auth/login", json={
            "email": "alice.f2@demo.io", "password": "Str0ngPass!x"})).json()["access_token"]
        he = {"Authorization": f"Bearer {etok}"}
        hb = {"Authorization": f"Bearer {btok}"}
        ha = {"Authorization": f"Bearer {atok}"}
        print("[1] three principals logged in; eve role=ATTACKER")

        cap_task = asyncio.create_task(capture(etok))
        await asyncio.sleep(0.3)

        # Alice composes -> async pipeline parks session inside window
        created = (await c.post(f"{BASE}/messages", json={
            "receiver_qsc_id": bob["unique_user_id"],
            "content": "flow two live secret",
            "security_requirement": "HIGH"}, headers=ha)).json()
        comm_id = created["communication_id"]
        msg_id = created["message_id"]
        print(f"[2] composed; comm={comm_id} initial status={created['status']}")

        # Eve races the window via her metadata-only target list
        attack = None
        for _ in range(300):
            act = (await c.get(f"{BASE}/communications/active", headers=he)).json()
            items = act.get("items", [])
            if any(a["id"] == comm_id for a in items):
                r = await c.post(f"{BASE}/communications/{comm_id}/attacks", json={
                    "attack_type": "INTERCEPT_AND_RESEND", "attack_strength": 1.0},
                    headers=he)
                assert r.status_code == 201, r.text
                attack = r.json()
                break
            await asyncio.sleep(0.02)
        assert attack is not None, "attack window never observed on live server"
        print(f"[3] attack launched mid-pipeline: qber {attack['qber_before']:.4f} -> "
              f"{attack['qber_after']:.4f} ({attack['detection_status']}) "
              f"session_state={attack['session_state']}")
        assert attack["detection_status"] == "DETECTED"
        assert attack["qber_after"] > attack["qber_before"]
        assert attack["session_state"] == "BLOCKED"

        # settle pipeline
        for _ in range(200):
            d = (await c.get(f"{BASE}/communications/{comm_id}", headers=ha)).json()
            if d["session_status"] in ("BLOCKED", "FAILED"):
                break
            await asyncio.sleep(0.05)
        assert d["session_status"] == "BLOCKED"

        inbox = (await c.get(f"{BASE}/messages/inbox", headers=hb)).json()
        assert all(i["id"] != msg_id for i in inbox["items"]), "blocked message leaked to inbox!"
        sent = (await c.get(f"{BASE}/messages/sent", headers=ha)).json()
        row = next(x for x in sent["items"] if x["id"] == msg_id)
        assert row["status"] == "BLOCKED" and row["attack_detected"] is True
        report = (await c.get(f"{BASE}/messages/{msg_id}/security-report", headers=ha)).json()["report"]
        assert report["key_status"] == "REJECTED" and report["delivery_status"] == "BLOCKED"
        print("[4] blocked message NOT in inbox; sender flagged BLOCKED; report REJECTED/BLOCKED")

        hist = (await c.get(f"{BASE}/attacks/history", headers=he)).json()
        assert any(h_["detection_status"] == "DETECTED" for h_ in hist["items"])
        summ = (await c.get(f"{BASE}/eve/dashboard/summary", headers=he)).json()
        assert summ["detected_attacks"] >= 1
        print(f"[5] eve history+summary updated (detection_rate={summ['detection_rate']})")

        await asyncio.sleep(1.0)
        types = [f.get("type") for f in frames if not str(f.get("type")).startswith("__")]
        print(f"[6] eve WS frames: {types}")
        for req_evt in ("attack.started", "attack.progress", "attack.detected"):
            assert req_evt in types, f"missing {req_evt} on eve channel"
        env0 = next(f for f in frames if f.get("type") == "attack.started")
        assert set(env0.keys()) == {"type", "communication_id", "state", "actor_role",
                                    "payload", "timestamp"}

    print("\nSCENARIO B LIVE PROOF: PASS")
    return 0


if __name__ == "__main__":
    import sys

    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    raise SystemExit(asyncio.run(main()))

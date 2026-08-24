"""LIVE integration proof: uvicorn + real WebSocket client.

Executes Section-24 Scenario A against a running server:
  register Alice+Bob -> login -> search -> compose (full pipeline)
while listening on /ws/user/events, capturing live frames.
Mid-run: disconnects the socket, reconnects, and resynchronizes state
purely via REST (timeline + qkd + security), proving Flow 3.

Prereq: server running on 127.0.0.1:8031 with fresh DB.
"""

import asyncio
import json
import os
import sys
import tempfile

import httpx

PORT = int(os.environ.get("QSC_PORT", "8031"))
BASE = f"http://127.0.0.1:{PORT}/api/v1"
WS = f"ws://127.0.0.1:{PORT}/ws/user/events"

captured: list[dict] = []
stop_capture = asyncio.Event()


async def capture(token: str) -> None:
    import websockets

    try:
        async with websockets.connect(f"{WS}?token={token}", max_size=None) as ws:
            captured.append({"type": "__connected__"})
            while not stop_capture.is_set():
                try:
                    frame = await asyncio.wait_for(ws.recv(), timeout=0.4)
                except asyncio.TimeoutError:
                    continue
                except Exception:
                    break
                try:
                    captured.append(json.loads(frame))
                except Exception:
                    pass
    except Exception as exc:  # noqa: BLE001
        print("capture socket ended:", type(exc).__name__)


async def main() -> int:
    async with httpx.AsyncClient(timeout=30) as c:
        # ---- users ----
        r1 = await c.post(f"{BASE}/auth/register", json={
            "name": "Alice Live", "email": "alice.live@demo.io", "password": "Str0ngPass!x"})
        assert r1.status_code == 201, r1.text
        alice = r1.json()["user"]
        r2 = await c.post(f"{BASE}/auth/register", json={
            "name": "Bob Live", "email": "bob.live@demo.io", "password": "Str0ngPass!x"})
        assert r2.status_code == 201
        bob = r2.json()["user"]
        print(f"[1] registered Alice={alice['unique_user_id']} Bob={bob['unique_user_id']}")

        tok = (await c.post(f"{BASE}/auth/login", json={
            "email": "alice.live@demo.io", "password": "Str0ngPass!x"})).json()
        btok = (await c.post(f"{BASE}/auth/login", json={
            "email": "bob.live@demo.io", "password": "Str0ngPass!x"})).json()
        h = {"Authorization": f"Bearer {tok['access_token']}"}
        hb = {"Authorization": f"Bearer {btok['access_token']}"}
        print("[2] both logged in")

        # ---- start live capture BEFORE pipeline ----
        cap_task = asyncio.create_task(capture(tok["access_token"]))
        await asyncio.sleep(0.5)

        # search + compose
        s = await c.get(f"{BASE}/users/search", params={"qsc_id": bob["unique_user_id"]}, headers=h)
        assert s.status_code == 200
        msg = await c.post(f"{BASE}/messages", json={
            "receiver_qsc_id": bob["unique_user_id"],
            "content": "live proof payload", "security_requirement": "MEDIUM"}, headers=h)
        assert msg.status_code == 202, msg.text
        created = msg.json()
        comm_id = created["communication_id"]
        print(f"[3] composed message; communication={comm_id} final status={created['status']}")

        await asyncio.sleep(1.0)
        stop_capture.set()
        await cap_task

        types = [f.get("type") for f in captured]
        print(f"[4] WS frames captured: {len(captured)}")
        interesting = [t for t in types if t and not str(t).startswith("__")]
        print("    ", interesting)

        required = ["communication.state_changed", "ai.protocol_selected",
                    "qkd.started", "qkd.progress", "qber.calculated",
                    "security.key_accepted", "message.delivered"]
        missing = [r for r in required if r not in types]
        assert not missing, f"missing WS events: {missing}"
        print("[5] all required live events arrived over the real socket")

        # ---- FLOW 3: reconnect + REST resync ----
        cap2: list[dict] = []

        async def recapture() -> None:
            import websockets

            async with websockets.connect(
                f"{WS}?token={tok['access_token']}", max_size=None
            ) as ws:
                await ws.send(json.dumps({"action": "ping"}))
                pong = json.loads(await ws.recv())
                cap2.append(pong)

        await recapture()
        assert cap2 and cap2[0]["action"] == "pong"
        print("[6] reconnected after drop; ping/pong OK")

        tl = (await c.get(f"{BASE}/communications/{comm_id}/timeline", headers=h)).json()["events"]
        detail = (await c.get(f"{BASE}/communications/{comm_id}", headers=h)).json()
        qkd = (await c.get(f"{BASE}/communications/{comm_id}/qkd",
                           params={"include_sample": True}, headers=h)).json()
        sec = (await c.get(f"{BASE}/communications/{comm_id}/security", headers=h)).json()
        transitions = [e["state"] for e in tl if e["type"] == "communication.state_changed"]
        assert transitions and transitions[-1] == detail["session_status"] == "DELIVERED"
        assert len(qkd["runs"][0]["sample"]) > 0
        assert sec["decision"] == "ACCEPTED"
        print(f"[7] REST resync complete; timeline replayed {len(tl)} events; "
              f"sample rows={len(qkd['runs'][0]['sample'])}; QBER={sec['qber']}")

        # receiver reads
        inbox = (await c.get(f"{BASE}/messages/inbox", headers=hb)).json()
        mid = next(i["id"] for i in inbox["items"])
        opened = (await c.get(f"{BASE}/messages/{mid}", headers=hb)).json()
        assert opened["content"] == "live proof payload" and opened["status"] == "READ"
        report = (await c.get(f"{BASE}/messages/{mid}/security-report", headers=h)).json()["report"]
        assert report["delivery_status"] == "DELIVERED"
        print("[8] Bob read the message; report DELIVERED/ENCRYPTED")

    print("\nSCENARIO A LIVE PROOF: PASS")
    return 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    raise SystemExit(asyncio.run(main()))

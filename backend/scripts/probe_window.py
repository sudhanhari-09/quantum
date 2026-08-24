import asyncio
import os

os.environ["DATABASE_URL"] = "sqlite:///./probe_async.db"
os.environ["RATE_LIMIT_AUTH_PER_MIN"] = "1000"
os.environ["RATE_LIMIT_SEARCH_PER_MIN"] = "1000"
os.environ["RATE_LIMIT_ATTACK_PER_MIN"] = "1000"

from httpx import ASGITransport, AsyncClient


async def main():
    import app.models  # noqa
    from app.db.base import Base
    from app.db.session import get_engine

    Base.metadata.create_all(get_engine())

    from sqlalchemy import text as _t

    with get_engine().begin() as conn:
        conn.execute(_t(
            "INSERT INTO protocol_configs (protocol,enabled,default_threshold,max_qubits,parameters,created_at) "
            "VALUES ('BB84',1,0.11,256,'{}',CURRENT_TIMESTAMP)"
        ))

    from app.core.config import get_settings

    s = get_settings()
    s.process_async = True
    s.pipeline_stage_delay_ms = 200

    from app.main import create_app

    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t", timeout=30) as c:
        await c.post("/api/v1/auth/register", json={"name": "Alice P", "email": "alice.probe@t.io", "password": "Str0ngPass!x"})
        await c.post("/api/v1/auth/register", json={"name": "Bob P", "email": "bob.probe@t.io", "password": "Str0ngPass!x"})
        await c.post("/api/v1/auth/register", json={"name": "Eve P", "email": "eve.probe@t.io", "password": "EvePass123!"})
        from sqlalchemy import text as sql_text

        from app.db.session import get_engine

        with get_engine().begin() as conn:
            conn.execute(sql_text("UPDATE users SET role='ATTACKER' WHERE email='eve.probe@t.io'"))

        atok = (await c.post("/api/v1/auth/login", json={"email": "alice.probe@t.io", "password": "Str0ngPass!x"})).json()["access_token"]
        etok = (await c.post("/api/v1/auth/login", json={"email": "eve.probe@t.io", "password": "EvePass123!"})).json()["access_token"]
        bob = (await c.post("/api/v1/auth/login", json={"email": "bob.probe@t.io", "password": "Str0ngPass!x"})).json()["user"]
        h = {"Authorization": f"Bearer {atok}"}
        he = {"Authorization": f"Bearer {etok}"}

        resp = await c.post("/api/v1/messages", json={
            "receiver_qsc_id": bob["unique_user_id"], "content": "probe",
            "security_requirement": "MEDIUM"}, headers=h)
        print("POST:", resp.json())
        comm_id = resp.json()["communication_id"]

        seen = []
        for i in range(60):
            d = (await c.get(f"/api/v1/communications/{comm_id}", headers=h)).json()
            act = (await c.get("/api/v1/communications/active", headers=he)).json()
            seen.append((d["session_status"], len(act.get("items", []))))
            if d["session_status"] in ("DELIVERED", "BLOCKED"):
                break
            await asyncio.sleep(0.05)
        for row in seen:
            print(row)


asyncio.run(main())

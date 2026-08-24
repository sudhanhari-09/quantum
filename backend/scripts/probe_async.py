import asyncio
import os

os.environ["DATABASE_URL"] = "sqlite:///./probe_async.db"

import httpx
from httpx import ASGITransport, AsyncClient


async def main():
    import app.models  # noqa
    from app.db.base import Base
    from app.db.session import get_engine

    Base.metadata.create_all(get_engine())
    from sqlalchemy import text

    with get_engine().begin() as c:
        c.execute(text(
            "INSERT INTO protocol_configs (protocol,enabled,default_threshold,max_qubits,parameters,created_at) "
            "VALUES ('BB84',1,0.11,256,'{}',CURRENT_TIMESTAMP)"
        ))

    from app.core.config import get_settings

    s = get_settings()
    s.process_async = True
    s.pipeline_stage_delay_ms = 10
    print("process_async:", s.process_async)

    from app.main import create_app

    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await c.post("/api/v1/auth/register", json={"name": "Al", "email": "alice.probe@t.io", "password": "Str0ngPass!x"})
        bob_login = (await c.post("/api/v1/auth/login", json={"email": "bob.probe@t.io", "password": "Str0ngPass!x"}))
        if bob_login.status_code != 200:
            await c.post("/api/v1/auth/register", json={"name": "Bo", "email": "bob.probe@t.io", "password": "Str0ngPass!x"})
            bob_login = (await c.post("/api/v1/auth/login", json={"email": "bob.probe@t.io", "password": "Str0ngPass!x"}))
        qid = bob_login.json()["user"]["unique_user_id"]
        tok = (await c.post("/api/v1/auth/login", json={"email": "alice.probe@t.io", "password": "Str0ngPass!x"})).json()["access_token"]
        h = {"Authorization": f"Bearer {tok}"}
        resp = await c.post("/api/v1/messages", json={"receiver_qsc_id": qid, "content": "hi", "security_requirement": "MEDIUM"}, headers=h)
        print("POST:", resp.status_code, resp.json())
        d = None
        for i in range(60):
            d = (await c.get("/api/v1/communications/1", headers=h)).json()
            if d.get("session_status") in ("DELIVERED", "BLOCKED"):
                break
            await asyncio.sleep(0.05)
        print("final:", d and d.get("session_status"))


asyncio.run(main())

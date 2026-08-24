import asyncio, json, os, tempfile
os.environ["DATABASE_URL"] = "sqlite:///" + tempfile.mkdtemp().replace("\\", "/") + "/exp.db"
from app.main import create_app
from httpx import ASGITransport, AsyncClient
async def main():
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        s = (await c.get("/openapi.json")).json()
        open("docs/openapi.json","w").write(json.dumps(s, indent=2))
        print(f"exported {len(s['paths'])} paths")
        for p in ["/api/v1/communications/{comm_id}/timeline","/api/v1/security-reports"]:
            print(p, "OK" if p in s["paths"] else "MISSING")
asyncio.run(main())

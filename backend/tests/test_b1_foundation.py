"""B1 acceptance: health returns 200; unknown route returns error envelope 404."""

from __future__ import annotations


async def test_health_ok(client):
    resp = await client.get("/api/v1/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert "version" in body
    assert body["db"] in {"ok", "error"}
    assert "X-Request-ID" in resp.headers


async def test_unknown_route_returns_envelope(client):
    resp = await client.get("/api/v1/definitely-not-a-route")
    assert resp.status_code == 404
    body = resp.json()
    # FastAPI default HTTPException is normalized by the envelope contract.
    assert set(body.keys()) == {"code", "message", "details"}
    assert isinstance(body["code"], str)

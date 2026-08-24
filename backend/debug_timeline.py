import asyncio
import sys
import os

# Add backend to path
sys.path.insert(0, r"C:\Users\smsbh\Desktop\quantam\backend")

from httpx import ASGITransport, AsyncClient
from app.main import create_app
from sqlalchemy import text

async def debug_timeline():
    app = create_app()
    transport = ASGITransport(app=app)
    
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # Register users
        resp = await client.post(
            "/api/v1/auth/register",
            json={"name": "AliceDebug", "email": "alice.debug@demo.io", "password": "Str0ngPass!x"},
        )
        assert resp.status_code == 201
        alice = resp.json()["user"]
        alice_creds = {"email": "alice.debug@demo.io", "password": "Str0ngPass!x"}
        
        resp = await client.post(
            "/api/v1/auth/register",
            json={"name": "BobDebug", "email": "bob.debug@demo.io", "password": "Str0ngPass!x"},
        )
        assert resp.status_code == 201
        bob = resp.json()["user"]
        bob_creds = {"email": "bob.debug@demo.io", "password": "Str0ngPass!x"}
        
        resp = await client.post(
            "/api/v1/auth/register",
            json={"name": "EveDebug", "email": "eve.debug@demo.io", "password": "EvePass123!"},
        )
        assert resp.status_code == 201
        eve = resp.json()["user"]
        eve_creds = {"email": "eve.debug@demo.io", "password": "EvePass123!"}
        
        # Promote Eve to ATTACKER
        engine = get_engine()
        with engine.begin() as conn:
            conn.execute(text("UPDATE users SET role='ATTACKER' WHERE email=:e"), {"e": eve_creds["email"]})
        
        atok = await login(client, alice_creds)
        btok = await login(client, bob_creds)
        etok = await login(client, eve_creds)
        
        # Create communication
        from app.db.session import session_scope
        from app.services.ai_recommendation_service import AiRecommendationService
        from app.services.auth_service import AuthService
        from app.services.messaging_service import MessagingService
        from app.services.qkd_service import QkdService
        
        with session_scope() as s:
            svc = AuthService(s)
            sender = svc.users.get_by_email(alice_creds["email"])
            receiver = svc.users.get_by_email(bob_creds["email"])
            ms = MessagingService(s)
            msg, comm = ms.create_message(sender, receiver.unique_user_id, "debug timeline", "HIGH")
            sm = ms.state_machine
            sm.transition(comm, "AI_ANALYZING")
            rec = AiRecommendationService(s).recommend(comm, "HIGH")
            comm.protocol = rec.protocol
            msg.protocol = rec.protocol
            sm.transition(comm, "PROTOCOL_SELECTED")
            sm.transition(comm, "QKD_INITIALIZING")
            sm.transition(comm, "QKD_RUNNING")
            baseline_row, _ = QkdService(s).execute_baseline(comm)
            sm.transition(comm, "KEY_SIFTING")
            sm.transition(comm, "QBER_EVALUATION")
            comm_id, msg_id, baseline_qber = comm.id, msg.id, baseline_row.qber
        
        # Launch attack
        attack = await client.post(
            f"/api/v1/communications/{comm_id}/attacks",
            json={"attack_type": "INTERCEPT_AND_RESEND", "attack_strength": 1.0},
            headers=auth_headers(etok),
        ).json()
        
        print(f"Attack detection_status: {attack['detection_status']}")
        
        # Get timeline
        tl = await client.get(f"/api/v1/communications/{comm_id}/timeline", headers=auth_headers(atok))
        events = tl.json()["events"]
        types = [e["type"] for e in events]
        print(f"Timeline event types count: {len(types)}")
        # Find attack-related types
        attack_types = [t for t in types if "attack" in t]
        print(f"Attack-related types: {attack_types}")
        print(f"Has attack.started: {'attack.started' in types}")
        print(f"Has attack.detected: {'attack.detected' in types}")
        
        # Show last 20 types
        print(f"Last 20 types: {types[-20:]}")

async def login(client, creds):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": creds["email"], "password": creds["password"]},
    )
    assert resp.status_code == 200
    return resp.json()

from app.db.session import get_engine

asyncio.run(debug_timeline())
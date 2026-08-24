import asyncio
import json
import websockets

async def test_ws():
    # Connect to WS eve events
    uri = "ws://localhost:8000/ws/eve/events?token=test"
    async with websockets.connect(uri) as ws:
        # Receive a message
        msg = await ws.recv()
        print(f"Received: {msg}")

asyncio.run(test_ws())
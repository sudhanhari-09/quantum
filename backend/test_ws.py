import asyncio
import httpx

async def test():
    ac = httpx.AsyncClient()
    print(hasattr(ac, 'ws_connect'))
    await ac.aclose()

asyncio.run(test())
import asyncio
from httpx import AsyncClient, Response

async def test():
    async with AsyncClient() as client:
        # Test health
        r: Response = await client.get('http://127.0.0.1:8000/health')
        print(f'GET /health: {r.status_code} {r.json()}')
        
        # Test auth/me without token
        r = await client.get('http://127.0.0.1:8000/api/v1/auth/me')
        print(f'GET /api/v1/auth/me (no token): {r.status_code}')
        
        # Test users/me without token
        r = await client.get('http://127.0.0.1:8000/api/v1/users/me')
        print(f'GET /api/v1/users/me (no token): {r.status_code}')
        
        # Test login with eve@qsc.dev credentials
        r = await client.post(
            'http://127.0.0.1:8000/api/v1/auth/login',
            json={'email': 'eve@qsc.dev', 'password': 'password'}
        )
        print(f'POST /api/v1/auth/login (eve): {r.status_code}')
        if r.status_code == 200:
            data = r.json()
            print(f'  access_token: {data.get("access_token", "")[:50]}...')
            print(f'  refresh_token: {data.get("refresh_token", "")[:50]}...')
            print(f'  user: {data.get("user", {})}')
        
        # Test auth/me with token
        if r.status_code == 200:
            token = r.json()['access_token']
            r = await client.get(
                'http://127.0.0.1:8000/api/v1/auth/me',
                headers={'Authorization': f'Bearer {token}'}
            )
            print(f'GET /api/v1/auth/me (with token): {r.status_code}')
            if r.status_code == 200:
                print(f'  user: {r.json()["user"]}')
            
            # Test users/me with token
            r = await client.get(
                'http://127.0.0.1:8000/api/v1/users/me',
                headers={'Authorization': f'Bearer {token}'}
            )
            print(f'GET /api/v1/users/me (with token): {r.status_code}')
            if r.status_code == 200:
                print(f'  user: {r.json()}')

asyncio.run(test())
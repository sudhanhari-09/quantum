import httpx
import asyncio

async def test():
    async with httpx.AsyncClient(base_url='http://127.0.0.1:8000') as client:
        # Register
        resp = await client.post('/api/v1/auth/register', json={'name': 'Test User', 'email': 'test@test.io', 'password': 'Str0ngPass!x'})
        print('Register:', resp.status_code)
        
        # Login 1
        resp = await client.post('/api/v1/auth/login', json={'email': 'test@test.io', 'password': 'Str0ngPass!x'})
        print('Login 1:', resp.status_code)
        tokens1 = resp.json()
        print('  access_token:', tokens1['access_token'][:20] + '...')
        
        # Logout
        headers = {'Authorization': f'Bearer {tokens1["access_token"]}'}
        resp = await client.post('/api/v1/auth/logout', json={'refresh_token': tokens1['refresh_token']}, headers=headers)
        print('Logout:', resp.status_code)
        
        # Login 2
        resp = await client.post('/api/v1/auth/login', json={'email': 'test@test.io', 'password': 'Str0ngPass!x'})
        print('Login 2:', resp.status_code)
        if resp.status_code != 200:
            print('  ERROR:', resp.json())
        else:
            tokens2 = resp.json()
            print('  access_token:', tokens2['access_token'][:20] + '...')
            print('SUCCESS!')

asyncio.run(test())
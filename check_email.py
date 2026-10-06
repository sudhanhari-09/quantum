from pydantic import EmailStr, ValidationError

emails = [
    'admin@qsc.local',
    'eve@qsc.local', 
    'alice.f2@demo.io',
    'bob.f2@demo.io',
    'eve.f2@demo.io',
    'alice.debug@demo.io',
    'bob.debug@demo.io',
    'eve.debug@demo.io',
    'regtest.final@qsc.dev',
    'hari@gmail.com',
    'spidey@gmail.com',
]

for email in emails:
    try:
        valid = EmailStr(email)
        print(f'{email}: VALID')
    except ValidationError as e:
        print(f'{email}: INVALID - {e}')
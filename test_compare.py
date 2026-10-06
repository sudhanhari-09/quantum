from app.models import User
from app.db.session import get_session_factory

s = get_session_factory()
db = s()
virat = db.query(User).filter(User.unique_user_id == 'QSC-VIUNKHVYI3').first()
dhoni = db.query(User).filter(User.unique_user_id == 'QSC-LWQQO3VD3L').first()

print('Scenario 1: Virat sends to Dhoni')
print(f'  sender.id = {virat.id}')
print(f'  receiver.id = {dhoni.id}')
print(f'  sender.id == receiver.id: {virat.id == dhoni.id}')
result1 = 'ALLOWED' if virat.id != dhoni.id else 'BLOCKED'
print(f'  Result: {result1}')

print()
print('Scenario 2: Virat sends to himself')
print(f'  sender.id = {virat.id}')
print(f'  receiver.id = {virat.id}')
print(f'  sender.id == receiver.id: {virat.id == virat.id}')
result2 = 'ALLOWED' if virat.id != virat.id else 'BLOCKED'
print(f'  Result: {result2}')

db.close()
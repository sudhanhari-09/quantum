import sqlite3

c = sqlite3.connect("qsc.db")
tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print("tables:", len(tables), sorted(tables))
print("protocol_configs:", c.execute("SELECT protocol, enabled, default_threshold FROM protocol_configs").fetchall())
print("users:", c.execute("SELECT email, role FROM users").fetchall())
print("version:", c.execute("SELECT version_num FROM alembic_version").fetchone()[0])

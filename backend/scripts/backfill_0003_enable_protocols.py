"""One-off repair: apply the 0003 data migration to a dev DB stamped past it.

The 0003_enable_all_protocols migration was created on a parallel Alembic
branch and never applied to databases already at 6b029071db87. After the
branch was linearized (6b029071db87 now revises 0003), fresh databases get
the UPDATE from `alembic upgrade head`; existing dev databases need this
one-time backfill. Safe to re-run (idempotent UPDATE).
"""
import sqlite3

TARGETS = ("B92", "E91", "SIX_STATE", "SARG04", "DECOY_BB84")

conn = sqlite3.connect("qsc.db")
placeholders = ",".join("?" for _ in TARGETS)
conn.execute(
    f"UPDATE protocol_configs SET enabled = 1 WHERE protocol IN ({placeholders})",
    TARGETS,
)
conn.commit()
for protocol, enabled in conn.execute(
    "SELECT protocol, enabled FROM protocol_configs ORDER BY protocol"
).fetchall():
    print(f"{protocol}: enabled={enabled}")
conn.close()

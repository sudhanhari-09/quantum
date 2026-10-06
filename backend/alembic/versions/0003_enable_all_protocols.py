"""enable all QKD protocols in protocol_configs

All six protocols (BB84, B92, E91, SIX_STATE, SARG04, DECOY_BB84) are now
fully implemented and should be enabled for manual selection and AI recommendation.

Revision ID: 0003_enable_all_protocols
Revises: 097be7581625
Create Date: 2026-09-01
"""
from alembic import op
import sqlalchemy as sa

revision = '0003_enable_all_protocols'
down_revision = '097be7581625'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text("UPDATE protocol_configs SET enabled = 1 WHERE protocol IN ('B92', 'E91', 'SIX_STATE', 'SARG04', 'DECOY_BB84')")
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text("UPDATE protocol_configs SET enabled = 0 WHERE protocol IN ('B92', 'E91', 'SIX_STATE', 'SARG04', 'DECOY_BB84')")
    )

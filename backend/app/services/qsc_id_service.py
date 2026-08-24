"""Unique QSC ID generation (B9).

Format: QSC-[A-Z0-9]{10} using secrets over a 36-char alphabet.
Generation function accepts an injected RNG for deterministic tests;
collision retry handled by callers inside register transaction.
"""

from __future__ import annotations

import secrets

ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
QSC_ID_REGEX = r"^QSC-[A-Z0-9]{10}$"


def generate_qsc_id(rng: secrets.SystemRandom | None = None) -> str:
    rng = rng or secrets.SystemRandom()
    body = "".join(rng.choice(ALPHABET) for _ in range(10))
    return f"QSC-{body}"


def is_valid_qsc_id(value: str) -> bool:
    import re

    return bool(re.match(QSC_ID_REGEX, value or ""))

"""QBER engine (B16): the only place QBER values are computed."""

from __future__ import annotations


class QberZeroDenominator(ValueError):
    pass


def compute_qber(errors: int, compared_bits: int) -> float:
    """QBER = errors / compared_bits; guard divide-by-zero; rounded to 6 dp."""
    if compared_bits <= 0:
        raise QberZeroDenominator("compared_bits must be positive to compute QBER")
    if errors < 0 or errors > compared_bits:
        raise ValueError("errors must be within [0, compared_bits]")
    return round(errors / compared_bits, 6)

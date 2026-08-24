import { mulberry32 } from "../mocks/engine";

const QUBITS = 256;

/** Mirrors the engine's BB84 math so tests pin the simulation semantics. */
export function simulateBb84Like(seed: number, isBaseline = true, strength = 0) {
  const rand = mulberry32(seed);
  const bases = ["R", "D"] as const;
  let matching = 0;
  let errors = 0;
  for (let i = 0; i < QUBITS; i++) {
    const aliceBit = rand() < 0.5 ? 0 : 1;
    const aliceBasis = bases[Math.floor(rand() * 2)]!;
    const bobBasis = bases[Math.floor(rand() * 2)]!;
    const noiseFlip = rand() < 0.01;
    let bobBit: 0 | 1 = aliceBit;
    if (aliceBasis !== bobBasis) bobBit = rand() < 0.5 ? 0 : 1;
    else if (noiseFlip) bobBit = aliceBit === 0 ? 1 : 0;
    if (!isBaseline && i < Math.round(strength * QUBITS)) {
      const eveBasis = bases[Math.floor(rand() * 2)]!;
      if (eveBasis !== aliceBasis && aliceBasis === bobBasis)
        bobBit = rand() < 0.5 ? 0 : 1;
    }
    const kept = aliceBasis === bobBasis;
    if (kept) matching++;
    if (kept && bobBit !== aliceBit) errors++;
  }
  return { matching, errors, qber: matching ? errors / matching : 0 };
}

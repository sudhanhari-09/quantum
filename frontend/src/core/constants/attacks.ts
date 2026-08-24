/**
 * §13 — Extensible attack-type registry.
 * v1 backend executes INTERCEPT_AND_RESEND only; other entries are registered
 * so the UI is future-ready without faking unsupported functionality.
 */
export interface AttackTypeDef {
  type: string;
  label: string;
  description: string;
  supported: boolean;
}

export const ATTACK_TYPE_REGISTRY: AttackTypeDef[] = [
  {
    type: "INTERCEPT_AND_RESEND",
    label: "Intercept & Resend",
    description:
      "Eve measures intercepted qubits in random bases and resends the results — the classic BB84 disturbance signature.",
    supported: true,
  },
  {
    type: "BIT_STATE_TAMPERING",
    label: "Bit / State Tampering",
    description: "Direct manipulation of transmitted classical bits. Planned for a future simulation release.",
    supported: false,
  },
  {
    type: "MITM_SIMULATION",
    label: "Man-in-the-Middle Simulation",
    description: "Full position-based interception with channel takeover. Planned for a future simulation release.",
    supported: false,
  },
];

export const STRENGTH_PRESETS = [
  { key: "LOW", value: 0.25, hint: "subtle probe · lower simulated impact" },
  { key: "MEDIUM", value: 0.55, hint: "moderate interception" },
  { key: "HIGH", value: 0.9, hint: "full-channel intercept · strongest simulated impact" },
] as const;

export function strengthLabel(v: number): "LOW" | "MEDIUM" | "HIGH" | "CUSTOM" {
  if (v <= 0.33) return "LOW";
  if (v <= 0.66) return "MEDIUM";
  return "HIGH";
}

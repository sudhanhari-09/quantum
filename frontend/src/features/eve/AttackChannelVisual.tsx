/**
 * §12 — Eve attack topology: Alice ──> EVE ──> Bob.
 * The flow itself changes during an attack; particles route through Eve and
 * disturbed states render red. Phases follow backend WS/REST state.
 */
export type AttackPhase =
  | "idle"
  | "intercepting"
  | "measuring"
  | "resending"
  | "evaluating"
  | "detected"
  | "undetected";

interface Props {
  phase: AttackPhase;
  /** 0..1 — fraction of qubits intercepted (drives particle density). */
  strength: number;
}

export function attackPhaseFromStep(step: number, detected: boolean | null): AttackPhase {
  if (step <= 0) return "idle";
  if (step === 1) return "intercepting";
  if (step === 2) return "measuring";
  if (step === 3) return "resending";
  if (step >= 7) return detected ? "detected" : "undetected";
  return "evaluating";
}

export function AttackChannelVisual({ phase, strength }: Props) {
  const intercepting = phase !== "idle" && phase !== "detected" && phase !== "undetected";
  const resending = intercepting && ["resending", "evaluating"].includes(phase);
  const doneDetected = phase === "detected";
  const doneClean = phase === "undetected";
  const eveActive = intercepting || doneDetected || doneClean;

  const aliceStroke = doneDetected ? "#dc2626" : intercepting ? "#f59e0b" : "#cbd5e1";
  const bobStroke = doneDetected ? "#dc2626" : resending ? "#f97316" : intercepting ? "transparent" : "#cbd5e1";

  // particle count scales with strength (visual density follows real parameter)
  const dots = Math.max(1, Math.round(strength * 4));

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-b from-red-50/50 via-surface to-surface p-4 sm:p-5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
          attack topology · simulated
        </span>
        {(doneDetected || doneClean) && (
          <span
            role="status"
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
              doneDetected ? "bg-danger text-white" : "bg-warning/15 text-warning"
            }`}
          >
            {doneDetected ? "DETECTED" : "NOT DETECTED"}
          </span>
        )}
      </div>

      <svg viewBox="0 0 420 120" className="w-full" role="img" aria-label={`Attack simulation: Eve intercepts ${Math.round(strength * 100)} percent of the channel`}>
        {/* baseline ghost line */}
        <line x1="70" y1="34" x2="350" y2="34" stroke="#e2e8f0" strokeWidth="1.5" strokeDasharray="4 6" />

        {/* Alice -> Eve */}
        <line
          x1="70"
          y1="34"
          x2="210"
          y2="60"
          stroke={aliceStroke}
          strokeWidth="2"
          strokeDasharray={intercepting ? "none" : "5 5"}
        />
        {/* Eve -> Bob */}
        <line x1="230" y1="60" x2="350" y2="34" stroke={bobStroke} strokeWidth="2" strokeDasharray={resending || doneClean || doneDetected ? "none" : "5 5"} />

        {/* interception particles: Alice -> Eve */}
        {intercepting &&
          Array.from({ length: dots }).map((_, i) => (
            <circle key={`a-${i}`} r={3 - i * 0.4} fill="#f59e0b">
              <animateMotion dur={`${1.4 + i * 0.25}s`} begin={`${i * 0.28}s`} repeatCount="indefinite" path="M75 35 L206 58" />
            </circle>
          ))}

        {/* resent particles: Eve -> Bob (disturbed = orange/red) */}
        {(resending || doneClean || doneDetected) &&
          Array.from({ length: dots }).map((_, i) => (
            <circle key={`b-${i}`} r={3 - i * 0.4} fill={doneDetected ? "#dc2626" : "#f97316"}>
              <animateMotion dur={`${1.2 + i * 0.22}s`} begin={`${i * 0.24}s`} repeatCount={intercepting ? "indefinite" : "3"} path="M236 62 L344 36" />
            </circle>
          ))}

        {/* Alice */}
        <rect x="30" y="10" width="40" height="48" rx="12" fill="url(#atk-node-a)" />
        <defs>
          <linearGradient id="atk-node-a" x1="30" y1="10" x2="70" y2="58">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#1d4ed8" />
          </linearGradient>
        </defs>
        <text x="50" y="39" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff">A</text>
        <text x="50" y="74" textAnchor="middle" fontSize="9.5" fontWeight="600" fill="#334155">ALICE</text>

        {/* Bob */}
        <rect x="350" y="10" width="40" height="48" rx="12" fill="#0f172a" />
        <text x="370" y="39" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff">B</text>
        <text x="370" y="74" textAnchor="middle" fontSize="9.5" fontWeight="600" fill="#334155">BOB</text>

        {/* EVE */}
        <g transform="translate(220 78)">
          <circle r="17" fill={eveActive ? "#fef2f2" : "#f8fafc"} stroke={eveActive ? "#dc2626" : "#e2e8f0"} strokeWidth="1.8" />
          <text y="5" textAnchor="middle" fontSize="13" fontWeight="800" fill={eveActive ? "#dc2626" : "#94a3b8"}>E</text>
          {eveActive && (
            <>
              <line x1="0" y1="-18" x2="-8" y2="-16" stroke="#dc2626" strokeWidth="1.6" />
              <circle r="22" fill="none" stroke="#dc2626" opacity="0.3">
                <animate attributeName="r" values="18;27;18" dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.4;0;0.4" dur="2s" repeatCount="indefinite" />
              </circle>
            </>
          )}
          <text y="34" textAnchor="middle" fontSize="9.5" fontWeight="700" fill={eveActive ? "#dc2626" : "#94a3b8"}>
            EVE{eveActive ? ` · ${Math.round(strength * 100)}% intercepted` : " · idle"}
          </text>
        </g>
      </svg>

      {/* phase caption */}
      <p aria-live="polite" className="text-center text-xs font-medium text-muted">
        {
          {
            idle: "Waiting for attack launch…",
            intercepting: "Intercepting simulated quantum states…",
            measuring: "Eve measures in random bases…",
            resending: "Resending measured results onward…",
            evaluating: "Recomputing error rate & security evaluation…",
            detected: "Disturbance exceeded threshold — key rejected, message blocked.",
            undetected: "Disturbance stayed within threshold — session resumed.",
          }[phase]
        }
      </p>
    </div>
  );
}

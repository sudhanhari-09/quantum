import { LogoMark } from "../../components/ui/Logo";
import { StatusPill } from "../../components/ui/StatusPill";
import type { CommState, KeyStatus } from "../../core/constants/vocab";
import type { QubitSampleRow } from "../../types/api";

const STAGE_LABELS = [
  "random bits",
  "encode states",
  "transmit & measure",
  "compare bases",
  "sift key",
  "compute QBER",
  "secure",
] as const;

/** Maps the backend state machine to a visual stage index (-1 = idle). */
export function stageFor(state?: CommState | null): number {
  switch (state) {
    case "QKD_INITIALIZING":
      return 0;
    case "QKD_RUNNING":
      return 2;
    case "KEY_SIFTING":
      return 4;
    case "QBER_EVALUATION":
    case "SECURITY_CHECK":
      return 5;
    case "KEY_ACCEPTED":
    case "ENCRYPTING":
    case "ENCRYPTED":
    case "DELIVERED":
    case "READ":
      return 6;
    case "ATTACK_DETECTED":
    case "KEY_REJECTED":
    case "BLOCKED":
      return 5;
    default:
      return -1;
  }
}

interface Props {
  state: CommState | null;
  protocol?: string | null;
  qber?: number | null;
  threshold?: number | null;
  keyStatus?: KeyStatus | string | null;
  attackDetected?: boolean;
  /** Actual transcript sample from the persisted run (max ~32 rows). */
  sample?: QubitSampleRow[];
  /** Live percent from qkd.progress WS events; null → derive from state. */
  progress?: number | null;
  compact?: boolean;
}

function Endpoint({
  side,
  active,
}: {
  side: "alice" | "bob";
  active: boolean;
}) {
  const isAlice = side === "alice";
  return (
    <div className="flex w-20 flex-col items-center gap-2 sm:w-24">
      <div
        className={`relative flex h-14 w-14 items-center justify-center rounded-2xl border shadow-sm transition-colors sm:h-16 sm:w-16 ${
          active
            ? isAlice
              ? "border-primary/40 bg-gradient-to-b from-blue-50 to-white"
              : "border-fg/20 bg-gradient-to-b from-slate-100 to-white"
            : "border-border bg-surface"
        }`}
        aria-hidden="true"
      >
        <LogoMark className="h-7 w-7 opacity-90" />
        <span
          className={`absolute -bottom-1.5 rounded-full border px-1.5 py-px text-[9px] font-bold tracking-wide ${
            active ? "border-primary/40 bg-primary text-white" : "border-border bg-surface text-muted"
          }`}
        >
          {isAlice ? "ALICE" : "BOB"}
        </span>
        {active && (
          <span className="absolute inset-0 animate-ping rounded-2xl border border-primary/25" />
        )}
      </div>
    </div>
  );
}

/** Basis-colored qubit cell: R = filled, D = ring; errors red; discarded dimmed. */
function QubitCell({
  basis,
  error,
  kept,
}: {
  basis: "R" | "D";
  error?: boolean;
  kept?: boolean;
}) {
  if (!kept && kept != null) {
    return <span className="h-3.5 w-3.5 rounded-[4px] bg-slate-100" title="basis mismatch · discarded" />;
  }
  if (error) {
    return (
      <span
        className="h-3.5 w-3.5 animate-pulse rounded-[4px] bg-red-500"
        title={`${basis}-basis measurement · ERROR`}
      />
    );
  }
  return basis === "R" ? (
    <span className="h-3.5 w-3.5 rounded-[4px] bg-blue-600" title="R basis ↕ · match" />
  ) : (
    <span className="h-3.5 w-3.5 rounded-[4px] border-2 border-cyan-500 bg-white" title="D basis ✕ · match" />
  );
}

/**
 * Signature live visualization: Alice → Quantum Channel → Bob.
 * Every visual state derives from backend state/WS props — never invented.
 */
export function QuantumChannelVisual({
  state,
  protocol,
  qber,
  threshold,
  keyStatus,
  attackDetected,
  sample,
  progress = null,
  compact = false,
}: Props) {
  const stage = stageFor(state);
  const flowing = state === "QKD_RUNNING" || state === "QKD_INITIALIZING";
  const attacked =
    attackDetected ||
    state === "ATTACK_DETECTED" ||
    state === "KEY_REJECTED" ||
    state === "BLOCKED";
  const secureDone = stage === 6 && !attacked;

  const channelStroke = attacked ? "#dc2626" : flowing || secureDone ? "#2563eb" : "#cbd5e1";
  const shownSample = (sample ?? []).slice(0, 16);
  const determinate = progress != null;

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-b from-blue-50/70 via-surface to-surface p-4 sm:p-5">
      {/* soft background motion */}
      <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-blue-100/50 blur-3xl anim-drift" />

      {/* nodes + channel */}
      <div className="relative flex items-start gap-1 sm:gap-2">
        <Endpoint side="alice" active={flowing || (stage >= 0 && stage < 6)} />

        <div className="relative min-w-0 flex-1 pt-4">
          <svg viewBox="0 0 220 46" className="h-11 w-full" aria-hidden="true">
            <line x1="6" y1="22" x2="214" y2="22" stroke={channelStroke} strokeWidth="2" strokeDasharray="6 5" opacity={flowing ? 1 : 0.8} />
            {/* Eve intercept marker sits mid-channel */}
            {attacked && (
              <>
                <circle cx="110" cy="10" r="8" fill="#fee2e2" stroke="#dc2626" strokeWidth="1.4" />
                <text x="110" y="13.4" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="#dc2626">E</text>
                <line x1="110" y1="18" x2="110" y2="22" stroke="#dc2626" strokeWidth="1.6" strokeDasharray="2.5 2.5" />
                <circle cx="110" cy="10" r="11" fill="none" stroke="#dc2626" opacity="0.35">
                  <animate attributeName="r" values="9;15;9" dur="2.2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.45;0;0.45" dur="2.2s" repeatCount="indefinite" />
                </circle>
              </>
            )}
            {(flowing || secureDone) && !attacked && (
              <>
                <circle r="3.4" fill="#2563eb">
                  <animateMotion dur="1.7s" repeatCount="indefinite" path="M10 22 H210" />
                </circle>
                <circle r="2.2" fill="#60a5fa">
                  <animateMotion dur="1.7s" begin="0.55s" repeatCount="indefinite" path="M10 22 H210" />
                </circle>
                <circle r="1.6" fill="#93c5fd">
                  <animateMotion dur="1.7s" begin="1.05s" repeatCount="indefinite" path="M10 22 H210" />
                </circle>
              </>
            )}
          </svg>

          {/* progress bound to qkd.progress events */}
          {(flowing || determinate) && !attacked && (
            <div className="mx-auto mt-1 max-w-xs">
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200/70" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={determinate ? Math.round(progress!) : undefined}>
                <div
                  className={`h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-700 transition-[width] duration-700 ${determinate ? "" : "w-1/2 animate-pulse"}`}
                  style={{ width: determinate ? `${Math.max(6, progress!)}%` : undefined }}
                />
              </div>
              <p className="mt-1 text-center text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
                quantum channel · simulated{determinate ? ` · ${Math.round(progress!)}%` : ""}
              </p>
            </div>
          )}
          {!flowing && !determinate && (
            <p className="mt-1 text-center text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
              quantum channel · simulated
            </p>
          )}

          {/* actual transcript sample */}
          {shownSample.length > 0 && !compact && (
            <div className="mx-auto mt-3 max-w-md space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">qubit transcript (sample)</p>
              <div className="flex items-center gap-2">
                <span className="w-8 text-right font-mono text-[10px] text-muted">A</span>
                <div className="flex flex-wrap gap-1">
                  {shownSample.map((r) => (
                    <QubitCell key={`a-${r.index}`} basis={r.alice_basis} kept />
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-8 text-right font-mono text-[10px] text-muted">B</span>
                <div className="flex flex-wrap gap-1">
                  {shownSample.map((r) => (
                    <QubitCell key={`b-${r.index}`} basis={r.bob_basis} error={r.error} kept={r.kept} />
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5 text-[10px] text-muted">
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[3px] bg-blue-600" /> R ↕ basis</span>
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[3px] border-2 border-cyan-500 bg-white" /> D ✕ basis</span>
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[3px] bg-slate-200" /> discarded</span>
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 animate-pulse rounded-[3px] bg-red-500" /> error</span>
              </div>
            </div>
          )}
        </div>

        <Endpoint side="bob" active={flowing || stage >= 2} />
      </div>

      {/* stage pipeline */}
      {!compact && (
        <ol className="relative mt-4 flex flex-wrap gap-1.5" aria-label="QKD stages">
          {STAGE_LABELS.map((label, i) => {
            const done = stage > i;
            const active = stage === i;
            return (
              <li key={label}>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    active
                      ? attacked
                        ? "border-danger/50 bg-danger/10 text-danger"
                        : "border-primary/50 bg-primary/10 text-primary"
                      : done
                        ? attacked
                          ? "border-danger/30 bg-danger/5 text-danger/80"
                          : "border-success/40 bg-success/5 text-success"
                        : "border-border text-muted/70"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 rounded-full ${
                      active
                        ? attacked
                          ? "bg-danger animate-pulse"
                          : "bg-primary animate-pulse"
                        : done
                          ? attacked
                            ? "bg-danger/70"
                            : "bg-success"
                          : "bg-slate-300"
                    }`}
                  />
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {/* counters + verdict */}
      {!compact && (
        <dl className="relative mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3 sm:grid-cols-4">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">Protocol</dt>
            <dd className="mt-1 font-mono text-sm font-bold">{protocol ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">QBER</dt>
            <dd
              className={`mt-1 font-mono text-sm font-bold ${
                attacked ? "text-danger" : qber != null && threshold != null && qber <= threshold ? "text-success" : ""
              }`}
            >
              {qber != null ? `${(qber * 100).toFixed(2)}%` : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">Key status</dt>
            <dd className="mt-1">{keyStatus ? <StatusPill value={String(keyStatus)} /> : <span className="text-sm text-muted">—</span>}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">Security</dt>
            <dd className="mt-1">
              <StatusPill value={attacked ? "ATTACK_DETECTED" : keyStatus === "ACCEPTED" ? "ACCEPTED" : state ?? "PENDING"} />
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

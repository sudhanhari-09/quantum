import { useEffect, useState } from "react";
import { Card } from "../../../components/ui/Card";
import { Badge, StatusPill } from "../../../components/ui/StatusPill";
import { ErrorPanel, Skeleton } from "../../../components/ui/Feedback";
import { useQkdRuns } from "../../../queries/hooks";
import { useWs } from "../../../core/wsContext";
import { QuantumChannelVisual } from "../QuantumChannelVisual";

const PIPELINE = [
  "generate bits",
  "alice bases",
  "encode states",
  "bob bases",
  "measure",
  "compare bases",
  "sift",
  "count errors",
  "QBER",
];

/** F12 — BB84 run visualization; all numbers from qkd_sessions rows + WS progress. */
export function QkdPanel({
  communicationId,
  sessionState = null,
}: {
  communicationId: number;
  sessionState?: import("../../../core/constants/vocab").CommState | null;
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [runIdx, setRunIdx] = useState<number | null>(null);
  const [liveProgress, setLiveProgress] = useState<number | null>(null);
  const subscribe = useWs();
  const { data, isPending, isError, error, refetch } = useQkdRuns(communicationId);

  // §10 — animation state follows actual backend events.
  useEffect(() => {
    const offProgress = subscribe("qkd.progress", (env) => {
      if (String(env.communication_id) !== String(communicationId)) return;
      setLiveProgress(Number(env.payload?.percent ?? 0));
    });
    const offDone = subscribe("qkd.completed", (env) => {
      if (String(env.communication_id) !== String(communicationId)) return;
      setLiveProgress(null);
    });
    return () => {
      offProgress();
      offDone();
    };
  }, [subscribe, communicationId]);

  if (isPending)
    return (
      <Card className="p-5">
        <Skeleton className="mb-3 h-4 w-40" />
        <Skeleton className="h-24" />
      </Card>
    );
  if (isError)
    return <ErrorPanel message={error.message} onRetry={() => refetch()} />;
  if (!data || data.runs.length === 0) return null;

  const runsDesc = [...data.runs].reverse();
  const active = runIdx == null ? runsDesc[0]! : runsDesc[Math.min(runIdx, runsDesc.length - 1)]!;
  const sample = active.sample ?? [];

  return (
    <Card className="p-5" aria-label="Simulated QKD run">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
          QKD simulation · {active.protocol}
        </h3>
        <div className="flex items-center gap-1.5">
          {runsDesc.length > 1 && (
            <select
              aria-label="Select run"
              className="rounded border border-border bg-surface px-2 py-1 text-xs"
              value={runIdx ?? 0}
              onChange={(e) => setRunIdx(Number(e.target.value))}
            >
              {runsDesc.map((r, i) => (
                <option key={r.id} value={i}>
                  {r.is_baseline ? "Baseline run" : `Post-attack rerun ${runsDesc.length - i - 1}`}
                </option>
              ))}
            </select>
          )}
          <StatusPill value={active.key_status} />
        </div>
      </div>

      {/* signature channel visualization */}
      <div className="mt-3">
        <QuantumChannelVisual
          state={sessionState}
          protocol={active.protocol}
          qber={active.qber}
          threshold={active.threshold}
          keyStatus={active.key_status}
          attackDetected={!active.is_baseline && active.qber > active.threshold}
          sample={sample}
          progress={liveProgress}
        />
      </div>

      {/* counter tiles */}
      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["qubits generated", active.qubits_generated],
          ["matching bases", active.matching_bases],
          ["sifted bits", active.sifted_bits],
          ["compared bits", active.compared_bits],
          ["errors", active.errors],
          ["qber", (active.qber * 100).toFixed(2) + "%"],
          ["threshold (sim)", (active.threshold * 100).toFixed(0) + "%"],
          ["key status", active.key_status],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-lg border border-border bg-slate-50/80 p-2.5 transition-colors hover:border-primary/30"
          >
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
            <dd className="mt-0.5 font-mono text-sm font-bold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {/* pipeline chips */}
      <ol className="mt-3 flex flex-wrap gap-1" aria-label="Pipeline stages">
        {PIPELINE.map((step) => (
          <li
            key={step}
            className={`rounded-full border px-2 py-0.5 text-[10px] ${
              active.qber != null ? "border-success/30 bg-success/5 text-success" : "border-border text-muted"
            }`}
          >
            {step}
          </li>
        ))}
      </ol>

      {/* raw transcript toggle */}
      <button
        type="button"
        onClick={() => setShowTranscript((v) => !v)}
        aria-expanded={showTranscript}
        className="mt-3 text-xs text-primary hover:underline"
      >
        {showTranscript ? "Hide" : "Show"} full qubit transcript ({sample.length} rows)
      </button>

      {showTranscript && (
        sample.length === 0 ? (
          <p className="mt-2 text-xs text-muted">Sample unavailable for this run.</p>
        ) : (
          <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-border">
            <table className="min-w-full divide-y divide-border text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  {["#", "a bit", "a basis", "b basis", "b bit", "match", "kept", "err"].map((h) => (
                    <th key={h} scope="col" className="px-2 py-1.5 text-left font-semibold uppercase text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 font-mono">
                {sample.map((row) => (
                  <tr key={row.index}>
                    <td className="px-2 py-1">{row.index}</td>
                    <td className="px-2 py-1">{row.alice_bit}</td>
                    <td className="px-2 py-1">{row.alice_basis}</td>
                    <td className="px-2 py-1">{row.bob_basis}</td>
                    <td className="px-2 py-1">{row.bob_bit}</td>
                    <td className="px-2 py-1">{row.basis_match ? "✓" : "✗"}</td>
                    <td className="px-2 py-1">{row.kept ? "✓" : "—"}</td>
                    <td className="px-2 py-1">
                      {row.error ? <Badge tone="danger">ERR</Badge> : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </Card>
  );
}

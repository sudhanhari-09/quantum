import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../../components/ui/Card";
import { EmptyState, ErrorPanel, Skeleton } from "../../components/ui/Feedback";
import { apiGet } from "../../core/apiClient";
import { useCommunications } from "../../queries/hooks";
import { QuantumChannelVisual } from "../communications/QuantumChannelVisual";
import type { QkdRun } from "../../types/api";

/** USER "QKD Simulation" hub: latest run per recent session. */
export function QkdSimulationsPage() {
  const comms = useCommunications("mine");
  const sessions = (comms.data?.items ?? []).slice(0, 6);
  const runs = useQuery({
    queryKey: ["qkd", "simulations", sessions.map((s) => s.id).join(",")],
    queryFn: async () => {
      const results = await Promise.all(
        sessions.map(async (c) => {
          try {
            const res = await apiGet<{ runs: QkdRun[] }>(`/communications/${c.id}/qkd`);
            return [c.id, res.runs] as const;
          } catch {
            return null;
          }
        }),
      );
      return Object.fromEntries(
        results.filter((p): p is readonly [number, QkdRun[]] => p != null),
      );
    },
    enabled: sessions.length > 0,
  });

  if (comms.isError)
    return <ErrorPanel message={(comms.error as Error).message} onRetry={() => comms.refetch()} />;

  return (
    <>
      <PageHeader
        title="QKD Simulation"
        subtitle="Live quantum key exchange across your communications"
      />
      {comms.isPending ? (
        <Skeleton className="h-64" />
      ) : sessions.length === 0 ? (
        <EmptyState
          title="No QKD sessions yet"
          hint="Compose a secure message to watch your first simulated BB84 run."
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {sessions.map((c) => {
            const runList = runs.data?.[c.id] ?? [];
            const run = runList[0];
            return (
              <div key={c.id} className="card card-hover p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold">
                      Session #{c.id}
                      <span className="ml-2 font-normal text-muted">
                        {c.sender.name} → {c.receiver.name}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {new Date(c.created_at).toLocaleString()}
                    </p>
                  </div>
                  <Link
                    to={`/communications/${c.id}`}
                    className="rounded-md border border-border px-2.5 py-1 text-xs transition hover:border-primary hover:text-primary"
                  >
                    Open live view →
                  </Link>
                </div>

                {run ? (
                  <>
                    <QuantumChannelVisual
                      compact
                      state={c.session_status}
                      protocol={run.protocol}
                      qber={run.qber}
                      threshold={run.threshold}
                      keyStatus={run.key_status}
                      attackDetected={!run.is_baseline && c.attack_detected}
                    />
                    <dl className="mt-3 grid grid-cols-4 gap-2">
                      {[
                        ["qubits", run.qubits_generated],
                        ["sifted", run.sifted_bits],
                        ["errors", run.errors],
                        ["qber", `${(run.qber * 100).toFixed(1)}%`],
                      ].map(([k, v]) => (
                        <div key={String(k)} className="rounded-lg border border-border bg-slate-50/70 p-2 text-center">
                          <dt className="text-[10px] uppercase tracking-wide text-muted">{k}</dt>
                          <dd className="font-mono text-sm font-bold">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </>
                ) : (
                  <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted">
                    No QKD run persisted for this session yet.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

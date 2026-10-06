import type { ReactNode } from "react";
import { Card, PageHeader } from "../../components/ui/Card";
import { StatusPill } from "../../components/ui/StatusPill";
import { EmptyState, ErrorPanel, Skeleton } from "../../components/ui/Feedback";
import { useDashboardSummary } from "../../queries/hooks";
import { QuantumChannelVisual } from "../communications/QuantumChannelVisual";
import { Badge } from "../../components/ui/StatusPill";

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "danger" | "success";
}) {
  const color =
    tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-fg";
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
    </Card>
  );
}

/** F5 - personal dashboard; every figure from GET /dashboard/summary. */
export function UserDashboard() {
  const { data, isPending, isError, error, refetch } = useDashboardSummary();

  if (isError)
    return <ErrorPanel message={error.message} code={(error as { code?: string }).code} onRetry={() => refetch()} />;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Live overview of your secure communications"
        actions={
          <button
            onClick={() => refetch()}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary"
          >
            Refresh
          </button>
        }
      />
      {isPending ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : data ? (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Messages sent" value={data.messages_sent} />
            <StatCard label="Messages received" value={data.messages_received} />
            <StatCard label="Delivered" value={data.messages_delivered} tone="success" />
            <StatCard
              label="Blocked"
              value={data.messages_blocked}
              tone={data.messages_blocked > 0 ? "danger" : "default"}
            />
            <StatCard
              label="Active sessions"
              value={data.active_communications}
              tone={data.active_communications > 0 ? "success" : "default"}
            />
            <StatCard
              label="Attacks on my sessions"
              value={data.attacks_on_mine}
              tone={data.attacks_on_mine > 0 ? "danger" : "default"}
            />
            <StatCard label="Average QBER" value={(data.average_qber * 100).toFixed(2) + "%"} />
          </div>

          {(data.messages_blocked > 0 || data.attacks_on_mine > 0) && (
            <div
              role="alert"
              className="mb-6 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger"
            >
              Security alert: attack activity was detected on your communications.
              Check your security reports for details.
            </div>
          )}

          {/* Active live communication */}
          {(() => {
            const live = data.recent.find(
              (c) => !["READ", "BLOCKED", "FAILED", "CREATED"].includes(c.session_status),
            );
            if (!live) return null;
            return (
              <div className="mb-6">
                <div className="mb-2 flex items-center justify-between">
                  <p className="section-title flex items-center gap-2">
                    <Badge tone="success">ACTIVE</Badge>
                    Live QKD session · #{live.id}
                  </p>
                  <a href={`/communications/${live.id}`} className="text-xs text-primary hover:underline">
                    open session →
                  </a>
                </div>
                <QuantumChannelVisual
                  compact
                  state={live.session_status}
                  protocol={live.protocol}
                  qber={live.qber}
                  threshold={0.11}
                  keyStatus={live.key_status}
                  attackDetected={live.attack_detected}
                />
              </div>
            );
          })()}

          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Recent communications
          </h2>
          {data.recent.length === 0 ? (
            <EmptyState
              title="No communications yet"
              hint="Compose a secure message to start your first QKD-backed conversation."
            />
          ) : (
            <div className="space-y-2">
              {data.recent.map((c) => {
                const isActive = !["READ", "BLOCKED", "FAILED", "CREATED"].includes(c.session_status);
                return (
                  <Card key={c.id} className="flex flex-wrap items-center gap-3 p-4">
                    <span className="font-mono text-xs text-muted">#{c.id}</span>
                    {isActive && <Badge tone="success">ACTIVE</Badge>}
                    <span className="text-sm font-medium">
                      {c.sender.name} → {c.receiver.name}
                    </span>
                    <StatusPill value={c.session_status} />
                    {c.protocol && (
                      <Badge tone="info">{c.protocol}</Badge>
                    )}
                    {c.qber != null && (
                      <span className="font-mono text-xs text-muted">
                        QBER: {(c.qber * 100).toFixed(2)}%
                      </span>
                    )}
                    {c.attack_detected && <Badge tone="danger">ATTACK</Badge>}
                    <span className="ml-auto text-xs text-muted">
                      {new Date(c.created_at).toLocaleString()}
                    </span>
                    <a
                      href={`/communications/${c.id}`}
                      className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
                    >
                      Open
                    </a>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      ) : null}
    </>
  );
}

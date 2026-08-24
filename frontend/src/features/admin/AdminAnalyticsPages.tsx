import { Link } from "react-router-dom";
import { Card, PageHeader } from "../../components/ui/Card";
import { Table, Td, Tr } from "../../components/ui/Table";
import { Badge } from "../../components/ui/StatusPill";
import { EmptyState, ErrorPanel, TableSkeleton } from "../../components/ui/Feedback";
import {
  useAdminSecurityEvents,
  useAdminSummary,
} from "../../queries/hooks";
import { QberMeter } from "../../components/ui/QberMeter";

/** ADMIN — platform communications monitor. */
export function AdminCommunicationsPage() {
  return (
    <>
      <PageHeader title="Communications" subtitle="Every session on the platform" />
      <PlatformCommunicationsTable />
    </>
  );
}

function PlatformCommunicationsTable() {
  // Uses the admin communications endpoint when available; the mock contract
  // serves it from the same in-memory store (no client-side fabrication).
  const events = useAdminSecurityEvents();
  if (events.isError)
    return <ErrorPanel message={(events.error as Error).message} onRetry={() => events.refetch()} />;
  const rows = events.data?.items ?? [];
  if (events.isPending) return <TableSkeleton cols={7} />;
  if (rows.length === 0)
    return (
      <EmptyState
        title="No platform communications yet"
        hint="Sessions appear here as users exchange secure messages."
      />
    );
  return (
    <Table head={["Session", "Protocol", "QBER", "Threshold", "Key", "Outcome", "When"]}>
      {rows.map((r, i) => (
        <Tr key={`${r.communication_id}-${i}`}>
          <Td className="font-mono text-xs">#{r.communication_id}</Td>
          <Td className="font-mono text-xs">{r.protocol}</Td>
          <Td className="font-mono text-xs">{(r.qber * 100).toFixed(2)}%</Td>
          <Td className="font-mono text-xs">{(r.threshold * 100).toFixed(0)}%</Td>
          <Td>
            <Badge tone={r.key_status === "ACCEPTED" ? "success" : r.key_status === "REJECTED" ? "danger" : "warning"}>
              {r.key_status}
            </Badge>
          </Td>
          <Td>
            <Badge tone={r.attack_detected || r.verdict === "BLOCKED" ? "danger" : "success"}>
              {r.attack_detected ? "ATTACK DETECTED" : r.verdict}
            </Badge>
          </Td>
          <Td className="text-xs text-muted">{new Date(r.created_at).toLocaleString()}</Td>
        </Tr>
      ))}
    </Table>
  );
}

/** §20 — attack analytics: totals, detection rate, QBER impact distribution. */
export function AdminAttacksPage() {
  const summary = useAdminSummary();
  const events = useAdminSecurityEvents();

  const attacksDetected = summary.data?.attacks_detected ?? 0;
  const attacksTotal = summary.data?.attacks_total ?? 0;
  const detectionRate = summary.data?.attack_detection_rate ?? 0;
  const rows = events.data?.items ?? [];
  const qberValues = rows.map((e) => e.qber);

  if (summary.isError)
    return <ErrorPanel message={(summary.error as Error).message} onRetry={() => summary.refetch()} />;

  return (
    <>
      <PageHeader
        title="Attack analytics"
        subtitle="Detection performance and error-rate impact across the platform"
      />

      {/* KPI tiles */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {summary.isPending || !summary.data
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-surface" />
            ))
          : [
              ["Total attacks", attacksTotal],
              ["Detected", attacksDetected],
              ["Undetected", attacksTotal - attacksDetected],
              ["Detection rate", `${(detectionRate * 100).toFixed(0)}%`],
            ].map(([label, value]) => (
              <Card key={String(label)} className="card-hover p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
                <p
                  className={`mt-1 text-3xl font-extrabold tabular-nums ${
                    label === "Detected" && Number(value) > 0 ? "text-danger" : ""
                  }`}
                >
                  {value}
                </p>
                {label === "Detection rate" && (
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-700 transition-[width] duration-700"
                      style={{ width: `${detectionRate * 100}%` }}
                    />
                  </div>
                )}
              </Card>
            ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {/* QBER meter against simulation threshold */}
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Latest recorded QBER vs simulation threshold
          </h3>
          {events.isPending || qberValues.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
              No security events yet.
            </p>
          ) : (
            <QberMeter qber={qberValues[0]} threshold={events.data!.items[0]!.threshold} />
          )}
          {qberValues.length > 0 && (
            <Link to="/admin/security" className="mt-3 inline-block text-xs text-primary hover:underline">
              inspect all security events →
            </Link>
          )}
        </Card>

        {/* per-event QBER impact list */}
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            QBER by event (newest first)
          </h3>
          {events.isPending || rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
              Nothing to chart yet.
            </p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {rows.slice(0, 12).map((r, i) => {
                const breached = r.qber > r.threshold;
                return (
                  <li key={i} className="flex items-center gap-3">
                    <span className="w-14 font-mono text-[11px] text-muted">#{r.communication_id}</span>
                    <div className="relative h-2.5 flex-1 rounded-full bg-slate-100">
                      <div
                        className={`absolute inset-y-0 left-0 rounded-full ${breached ? "bg-red-500" : "bg-emerald-500"}`}
                        style={{ width: `${Math.min(100, r.qber * 100)}%` }}
                      />
                      <div
                        aria-hidden="true"
                        className="absolute -top-0.5 h-3.5 w-px bg-fg/60"
                        style={{ left: `${Math.min(100, r.threshold * 100)}%` }}
                      />
                    </div>
                    <span className={`w-16 text-right font-mono text-[11px] ${breached ? "font-bold text-danger" : ""}`}>
                      {(r.qber * 100).toFixed(1)}%
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-muted">
            Vertical tick marks each event&apos;s simulation threshold ({rows[0] ? `${(rows[0]!.threshold * 100).toFixed(0)}%` : "—"}).
          </p>
        </Card>
      </div>
    </>
  );
}

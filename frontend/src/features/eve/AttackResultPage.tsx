import { Link, useParams } from "react-router-dom";
import { Card, PageHeader } from "../../components/ui/Card";
import { Badge } from "../../components/ui/StatusPill";
import { ErrorPanel, Skeleton } from "../../components/ui/Feedback";
import { useAttack } from "../../queries/hooks";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** F24 — attack outcome: numbers, detection verdict, impact. */
export function AttackResultPage() {
  const { attackId } = useParams();
  const id = attackId ? Number(attackId) : undefined;
  const { data: a, isPending, isError, error } = useAttack(id);

  if (isPending)
    return (
      <>
        <PageHeader title="Attack result" />
        <Skeleton className="h-72" />
      </>
    );
  if (isError || !a)
    return <ErrorPanel message={(error as Error)?.message ?? "Attack not found"} />;

  const detected = a.detection_status === "DETECTED";
  const chart = [
    { name: "before", QBER: Number((a.qber_before * 100).toFixed(2)) },
    { name: "after", QBER: Number((a.qber_after * 100).toFixed(2)) },
  ];

  return (
    <>
      <PageHeader
        title={`Attack #${a.id} · session #${a.communication_id}`}
        subtitle={`${a.attack_type.replace(/_/g, " ")} · strength ${(a.attack_strength * 100).toFixed(0)}%`}
        actions={
          <Link
            to="/eve/attack/history"
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary"
          >
            Attack history
          </Link>
        }
      />
      <Card className="max-w-2xl p-6">
        <div
          role="status"
          className={`mb-5 rounded-lg border px-4 py-3 ${
            detected ? "border-danger/40 bg-danger/10" : "border-warning/40 bg-warning/10"
          }`}
        >
          <p className={`text-base font-bold ${detected ? "text-danger" : "text-warning"}`}>
            {detected ? "DETECTED — key rejected, message blocked" : "NOT DETECTED — session resumed"}
          </p>
          <p className="mt-1 text-xs text-muted">
            {detected
              ? "The post-attack error rate exceeded the simulation threshold."
              : "The post-attack error rate stayed within the simulation threshold."}
          </p>
        </div>

        <div className="mb-5 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 12 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} unit="%" />
              <Tooltip
                contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="QBER" fill={detected ? "#ef4444" : "#eab308"} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-border pt-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">States intercepted</dt>
            <dd className="mt-0.5 font-mono">{a.states_intercepted}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">States modified</dt>
            <dd className="mt-0.5 font-mono">{a.states_modified}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">QBER before</dt>
            <dd className="mt-0.5 font-mono">{(a.qber_before * 100).toFixed(2)}%</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">QBER after</dt>
            <dd className="mt-0.5 font-mono">{(a.qber_after * 100).toFixed(2)}%</dd>
          </div>
        </dl>

        {a.threshold != null && (
          <p className="mt-3 border-t border-border pt-3 text-[11px] text-muted">
            Simulation threshold: {(Number(a.threshold) * 100).toFixed(0)}% (not a physics limit).
          </p>
        )}

        {detected && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone="danger">KEY_REJECTED</Badge>
            <Badge tone="danger">message BLOCKED</Badge>
            <Badge tone="neutral">never delivered</Badge>
          </div>
        )}
      </Card>
    </>
  );
}

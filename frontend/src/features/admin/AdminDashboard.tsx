import { Card, PageHeader } from "../../components/ui/Card";
import { Skeleton, ErrorPanel } from "../../components/ui/Feedback";
import { useAdminSummary, useProtocols } from "../../queries/hooks";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  LineChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LiveIndicator } from "../../components/ui/FeedbackGlobal";

const PIE_COLORS = ["#22c55e", "#ef4444", "#eab308"];

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </Card>
  );
}

/** F26 — admin command center; all aggregates from the backend. */
export function AdminDashboard() {
  const { data, isPending, isError, error, refetch } = useAdminSummary();
  const protocols = useProtocols();

  if (isError)
    return (
      <>
        <PageHeader title="Platform overview" />
        <ErrorPanel message={(error as Error).message} onRetry={() => refetch()} />
      </>
    );

  return (
    <>
      <PageHeader
        title="Platform overview"
        subtitle="Live aggregates across the whole platform"
        actions={<LiveIndicator />}
      />
      {isPending || !data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total users" value={data.total_users} />
            <StatCard label="Active communications" value={data.active_communications} />
            <StatCard label="Messages delivered" value={data.messages_delivered} />
            <StatCard label="Messages blocked" value={data.messages_blocked} />
            <StatCard label="Attacks total" value={data.attacks_total} />
            <StatCard label="Attacks detected" value={data.attacks_detected} />
            <StatCard
              label="Detection rate"
              value={`${(data.attack_detection_rate * 100).toFixed(0)}%`}
            />
            <StatCard
              label="Average QBER"
              value={`${(data.average_qber * 100).toFixed(2)}%`}
            />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
                Communications per day
              </h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.communications_per_day}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} />
                    <Line type="monotone" dataKey="count" stroke="#38bdf8" strokeWidth={2} dot={false} name="comms" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
                Security outcomes
              </h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.security_outcomes}
                      dataKey="count"
                      nameKey="outcome"
                      innerRadius={45}
                      outerRadius={75}
                      paddingAngle={4}
                    >
                      {data.security_outcomes.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
                Protocol usage
              </h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" data={data.protocol_usage}>
                    <XAxis type="number" allowDecimals={false} hide />
                    <YAxis
                      type="category"
                      dataKey="protocol"
                      width={90}
                      tick={{ fill: "#94a3b8", fontSize: 11 }}
                    />
                    <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="sessions" fill="#38bdf8" radius={[0, 4, 4, 0]} name="sessions" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* recent audit feed */}
          <Card className="mt-5 p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
              Recent audit activity
            </h3>
            <ul className="space-y-1.5 text-xs">
              {data.recent_audit.length === 0 && (
                <li className="text-muted">No audit entries yet.</li>
              )}
              {data.recent_audit.map((row) => (
                <li key={row.id} className="flex flex-wrap items-baseline gap-2 border-b border-border/40 pb-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-primary">
                    {row.action}
                  </span>
                  <span className="text-fg">{row.description}</span>
                  <time className="ml-auto font-mono text-[10px] text-muted">
                    {new Date(row.created_at).toLocaleTimeString()}
                  </time>
                </li>
              ))}
            </ul>
          </Card>

          {/* registry truth */}
          {protocols.data && (
            <p className="mt-4 text-xs text-muted">
              Protocol registry:{" "}
              {protocols.data.map((p) => `${p.name}${p.supported ? "" : " (stub)"}`).join(" · ")}
            </p>
          )}
        </>
      )}
    </>
  );
}

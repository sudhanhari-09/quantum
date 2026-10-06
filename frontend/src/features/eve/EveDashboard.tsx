import { useState } from "react";
import { Card, PageHeader } from "../../components/ui/Card";
import { Skeleton, EmptyState, ErrorPanel } from "../../components/ui/Feedback";
import { Table, Td, Tr } from "../../components/ui/Table";
import { Badge, StatusPill } from "../../components/ui/StatusPill";
import {
  useActiveSessions,
  useEveSummary,
} from "../../queries/hooks";
import type { ActiveSession } from "../../types/api";
import { useNavigate } from "react-router-dom";
import { ATTACK_WINDOW_STATES } from "../../core/constants/vocab";

export const WINDOW_STATES = ATTACK_WINDOW_STATES;

/** F19 - simulated-role onboarding banner. */
export function RoleOnboardingBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div
      role="note"
      className="mb-6 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger"
    >
      <div className="flex items-start justify-between gap-3">
        <p>
          <strong>Simulated attacker zone.</strong> You are signed in as EVE on demo
          data. You can observe session metadata and launch the{" "}
          <em>simulated intercept-and-resend</em> attack - you can never read message
          content or key material.
        </p>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss banner"
          className="text-danger/70 hover:text-danger"
        >
          X
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : ""}`}>
        {value}
      </p>
    </Card>
  );
}

function SessionsTable({
  sessions,
  action,
}: {
  sessions: ActiveSession[];
  action: (s: ActiveSession) => React.ReactNode;
}) {
  return (
    <Table head={["#", "Sender", "Receiver", "Protocol", "State", "Opened", ""]}>
      {sessions.map((s) => {
        const inWindow = ATTACK_WINDOW_STATES.includes(s.session_state);
        return (
          <Tr key={s.id}>
            <Td className="font-mono text-xs">#{s.id}</Td>
            <Td>{s.sender_name}</Td>
            <Td>{s.receiver_name}</Td>
            <Td className="font-mono text-xs">{s.protocol ?? "pending"}</Td>
            <Td>
              <StatusPill value={s.session_state} />
              {inWindow && (
                <Badge tone="danger" className="ml-1">attackable</Badge>
              )}
            </Td>
            <Td className="text-xs text-muted">{new Date(s.created_at).toLocaleTimeString()}</Td>
            <Td>{action(s)}</Td>
          </Tr>
        );
      })}
    </Table>
  );
}

export function ConfigureButton({ session }: { session: ActiveSession }) {
  const navigate = useNavigate();
  const openWindow = WINDOW_STATES.includes(session.session_state);
  if (!openWindow)
    return <Badge tone="neutral">window closed</Badge>;
  return (
    <button
      onClick={() =>
        navigate(`/eve/attack/configure/${session.id}`, { state: { session } })
      }
      className="rounded-md border border-danger/50 px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger/10"
    >
      Configure attack
    </button>
  );
}

/** F20 - EVE dashboard with live summary + eligible targets. */
export function EveDashboard() {
  const summary = useEveSummary();
  const sessions = useActiveSessions();

  if (summary.isError)
    return (
      <>
        <RoleOnboardingBanner />
        <ErrorPanel
          message={(summary.error as Error).message}
          onRetry={() => summary.refetch()}
        />
      </>
    );

  return (
    <>
      <PageHeader
        title="EVE dashboard"
        subtitle="Simulated eavesdropping overview - sessions update in real time"
        actions={
          <button
            onClick={() => { summary.refetch(); sessions.refetch(); }}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary"
          >
            Refresh
          </button>
        }
      />
      <RoleOnboardingBanner />
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {summary.isPending || !summary.data ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)
        ) : (
          <>
            <StatCard label="Eligible active sessions" value={summary.data.active_sessions} tone={summary.data.active_sessions > 0 ? "danger" : undefined} />
            <StatCard label="Total attacks" value={summary.data.total_attacks} />
            <StatCard
              label="Detected"
              value={summary.data.detected_attacks}
              tone={summary.data.detected_attacks > 0 ? "danger" : undefined}
            />
            <StatCard
              label="Detection rate"
              value={`${(summary.data.detection_rate * 100).toFixed(0)}%`}
            />
          </>
        )}
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
        Live targets (metadata only)
      </h2>
      {sessions.isPending ? (
        <Skeleton className="h-40" />
      ) : (sessions.data?.items ?? []).length === 0 ? (
        <EmptyState
          title="No active sessions eligible for attack"
          hint="Sessions appear here only while their QKD run is inside the attack window (QKD_INITIALIZING through SECURITY_CHECK)."
        />
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2">
            <Badge tone="danger">{sessions.data!.items.length} active</Badge>
            <span className="text-xs text-muted">
              Select a session and configure an intercept-and-resend attack
            </span>
          </div>
          <SessionsTable
            sessions={sessions.data!.items}
            action={(s) => <ConfigureButton session={s} />}
          />
        </>
      )}
    </>
  );
}

/** F21 - dedicated target picker. */
export function ActiveSessionsPage() {
  const sessions = useActiveSessions();
  return (
    <>
      <PageHeader title="Active communications" subtitle="Sessions inside the attack window" />
      {sessions.isError ? (
        <ErrorPanel message={(sessions.error as Error).message} onRetry={() => sessions.refetch()} />
      ) : sessions.isPending ? (
        <Skeleton className="h-40" />
      ) : (sessions.data?.items ?? []).length === 0 ? (
        <EmptyState title="No attackable communications right now" />
      ) : (
        <SessionsTable
          sessions={sessions.data!.items}
          action={(s) => <ConfigureButton session={s} />}
        />
      )}
    </>
  );
}

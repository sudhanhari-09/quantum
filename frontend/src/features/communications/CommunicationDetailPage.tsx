import { Link, useParams } from "react-router-dom";
import { Card, PageHeader } from "../../components/ui/Card";
import { StatusPill } from "../../components/ui/StatusPill";
import { StateStepper } from "../../components/ui/StateStepper";
import { ErrorPanel, Skeleton, EmptyState } from "../../components/ui/Feedback";
import { useCommunication, useQkdRuns } from "../../queries/hooks";
import { RecommendationPanel } from "./panels/RecommendationPanel";
import { QkdPanel } from "./panels/QkdPanel";
import { SecurityPanel } from "./panels/SecurityPanel";
import { TransmissionPanel } from "./panels/TransmissionPanel";
import { StateTimelinePanel } from "./StateTimelinePanel";
import { QuantumChannelVisual } from "./QuantumChannelVisual";
import { Badge } from "../../components/ui/StatusPill";
import { ATTACK_WINDOW_STATES } from "../../core/constants/vocab";

const PRE_QKD = new Set(["CREATED", "RECEIVER_VERIFIED", "AI_ANALYZING", "PROTOCOL_SELECTED"]);

/** Shows protocol history from QKD runs. */
function ProtocolHistory({ communicationId }: { communicationId: number }) {
  const { data } = useQkdRuns(communicationId);
  if (!data || data.runs.length <= 1) return null;

  const runs = data.runs;
  return (
    <Card className="mb-5 p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
        Protocol History ({runs.length} runs)
      </h3>
      <div className="space-y-2">
        {runs.map((run, i) => (
          <div
            key={run.id}
            className={`flex items-center gap-3 rounded-lg border p-3 text-sm ${
              run.is_baseline
                ? "border-primary/30 bg-primary/5"
                : run.qber > run.threshold
                  ? "border-danger/30 bg-danger/5"
                  : "border-success/30 bg-success/5"
            }`}
          >
            <span className="font-mono text-xs text-muted">Run #{i + 1}</span>
            <Badge tone={run.is_baseline ? "info" : "warning"}>
              {run.is_baseline ? "BASELINE" : "POST-ATTACK/RETRY"}
            </Badge>
            <span className="font-mono text-xs font-semibold">{run.protocol}</span>
            <span className="text-xs text-muted">QBER: {(run.qber * 100).toFixed(2)}%</span>
            <StatusPill value={run.key_status} />
            {run.qber > run.threshold && (
              <Badge tone="danger">FAILED</Badge>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Shows the latest attack details for this communication. */
function AttackInfo({ communicationId }: { communicationId: number }) {
  const { data: qkdData } = useQkdRuns(communicationId);
  // We don't have direct attack ID from comm, but we can check QKD runs for post-attack
  const postAttackRuns = qkdData?.runs.filter((r) => !r.is_baseline) ?? [];
  if (postAttackRuns.length === 0) return null;

  return (
    <Card className="mb-5 p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
        Attack Activity
      </h3>
      <div className="space-y-2">
        {postAttackRuns.map((run) => (
          <div
            key={run.id}
            className="flex items-center gap-3 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm"
          >
            <Badge tone="danger">POST-ATTACK</Badge>
            <span className="font-mono text-xs">{run.protocol}</span>
            <span className="text-xs text-muted">
              QBER: {(run.qber * 100).toFixed(2)}%
              {run.qber > run.threshold && " (exceeded threshold)"}
            </span>
            <StatusPill value={run.key_status} />
          </div>
        ))}
      </div>
    </Card>
  );
}

/** F9 - master status page for one communication. */
export function CommunicationDetailPage() {
  const { communicationId } = useParams();
  const id = communicationId ? Number(communicationId) : undefined;
  const { data: comm, isPending, isError, error, refetch } = useCommunication(id);

  if (isPending)
    return (
      <>
        <PageHeader title="Communication" />
        <Skeleton className="h-24" />
      </>
    );
  if (isError || !comm)
    return (
      <ErrorPanel
        message={error?.message ?? "Session not found"}
        code={(error as unknown as { code?: string })?.code}
        onRetry={() => refetch()}
      />
    );

  const blockedLike = ["ATTACK_DETECTED", "KEY_REJECTED", "BLOCKED"].includes(comm.session_status);
  const inAttackWindow = ATTACK_WINDOW_STATES.includes(comm.session_status);
  const isTerminal = ["READ", "BLOCKED", "FAILED"].includes(comm.session_status);
  const isActive = !isTerminal && comm.session_status !== "CREATED";

  return (
    <>
      <PageHeader
        title={`Communication #${comm.id}`}
        subtitle={`${comm.sender.name} → ${comm.receiver.name}`}
        actions={
          <>
            {isActive && (
              <Badge tone="success" className="mr-2">ACTIVE</Badge>
            )}
            <Link
              to="/security-reports"
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary"
            >
              Security reports
            </Link>
            <Link
              to="/dashboard"
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary"
            >
              Back to dashboard
            </Link>
          </>
        }
      />

      {blockedLike && (
        <div role="alert" className="anim-pop mb-5 rounded-lg border border-danger/40 bg-red-50 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-danger">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
            Attack detected - this communication was blocked
          </p>
          <p className="mt-1 text-xs text-danger/80">
            The eavesdropping simulation raised the error rate beyond the simulation
            threshold; the key was rejected and the message was never delivered.
          </p>
        </div>
      )}

      {inAttackWindow && (
        <div className="mb-5 rounded-lg border border-warning/40 bg-yellow-50 px-4 py-3 text-sm text-warning">
          <p className="font-semibold">Inside attack window</p>
          <p className="mt-1 text-xs text-warning/80">
            This communication is currently in the QKD phase where Eve can launch an intercept-and-resend attack.
          </p>
        </div>
      )}

      <div className="mb-5">
        <QuantumChannelVisual
          state={comm.session_status}
          protocol={comm.protocol}
          qber={comm.qber}
          threshold={comm.threshold ?? 0.11}
          keyStatus={comm.key_status}
          attackDetected={comm.attack_detected}
        />
      </div>

      <Card className="mb-5 p-5">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {isActive && <Badge tone="success">ACTIVE</Badge>}
          {comm.protocol && <Badge tone="info">{comm.protocol}</Badge>}
          <StatusPill value={comm.session_status} />
        </div>
        <StateStepper current={comm.session_status} />
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-border pt-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Protocol</dt>
            <dd className="mt-0.5 font-mono font-semibold">{comm.protocol ?? "pending"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Message status</dt>
            <dd className="mt-0.5"><StatusPill value={comm.message_status} /></dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Key status</dt>
            <dd className="mt-0.5"><StatusPill value={comm.key_status} /></dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">QBER</dt>
            <dd className="mt-0.5 font-mono">
              {comm.qber != null ? `${(comm.qber * 100).toFixed(2)}%` : "---"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Threshold</dt>
            <dd className="mt-0.5 font-mono">
              {comm.threshold != null ? `${(comm.threshold * 100).toFixed(0)}%` : "11%"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Attack detected</dt>
            <dd className="mt-0.5">
              {comm.attack_detected ? <Badge tone="danger">YES</Badge> : <Badge tone="success">NO</Badge>}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Created</dt>
            <dd className="mt-0.5">{new Date(comm.created_at).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Completed</dt>
            <dd className="mt-0.5">
              {comm.completed_at ? new Date(comm.completed_at).toLocaleString() : "---"}
            </dd>
          </div>
        </dl>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {!PRE_QKD.has(comm.session_status) && (
          <>
            <QkdPanel communicationId={id!} sessionState={comm.session_status} />
            <SecurityPanel communicationId={id!} />
          </>
        )}
        <TransmissionPanel
          status={comm.message_status}
          protocol={comm.protocol}
          qber={comm.qber}
          keyStatus={comm.key_status}
          attackDetected={comm.attack_detected}
        />
        <RecommendationPanel communicationId={id!} sessionState={comm.session_status} />
        <div className="xl:col-span-2">
          <ProtocolHistory communicationId={id!} />
          <AttackInfo communicationId={id!} />
          <StateTimelinePanel communicationId={id!} />
        </div>
      </div>

      {PRE_QKD.has(comm.session_status) && comm.session_status === "CREATED" && (
        <EmptyState
          title="Waiting for the secure pipeline to start"
          hint="The backend orchestrates receiver verification, protocol execution and the simulated QKD run."
        />
      )}
    </>
  );
}

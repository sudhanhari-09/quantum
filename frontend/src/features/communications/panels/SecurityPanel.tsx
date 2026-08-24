import { Card } from "../../../components/ui/Card";
import { StatusPill } from "../../../components/ui/StatusPill";
import { Skeleton } from "../../../components/ui/Feedback";
import { QberMeter } from "../../../components/ui/QberMeter";
import { useSecurityState } from "../../../queries/hooks";

/** F13 — security verdict panel; plots backend numbers only. */
export function SecurityPanel({ communicationId }: { communicationId: number }) {
  const { data, isPending } = useSecurityState(communicationId);

  if (isPending || !data)
    return (
      <Card className="p-5">
        <Skeleton className="mb-3 h-4 w-32" />
        <Skeleton className="h-28" />
      </Card>
    );

  const accepted = data.decision === "ACCEPTED";
  const rejected = data.decision === "REJECTED";

  return (
    <Card className="p-5" aria-label="Security decision">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Security evaluation
        </h3>
        <StatusPill value={data.decision === "PENDING" ? "PENDING" : accepted ? "ACCEPTED" : "REJECTED"} />
      </div>

      {/* §15 animated meter with threshold marker */}
      <div className="mt-4">
        <QberMeter qber={data.qber} threshold={data.threshold} />
      </div>

      {data.decision !== "PENDING" && (
        <div
          role="status"
          className={`anim-pop mt-4 flex items-center gap-3 rounded-lg border px-4 py-3 ${
            accepted ? "border-success/40 bg-success/10" : "border-danger/40 bg-red-50"
          }`}
        >
          {/* verdict icon */}
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className={`h-7 w-7 shrink-0 ${accepted ? "text-success" : rejected ? "text-danger" : "text-warning"}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {accepted && (
              <>
                <path d="M12 22s8-3.6 8-10V5l-8-3-8 3v7c0 6.4 8 10 8 10z" />
                <path d="M9 11.5l2 2 4-4.5" />
              </>
            )}
            {!accepted && (
              <>
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <path d="M12 9v4M12 17h.01" />
              </>
            )}
          </svg>
          <div>
            <p className={`text-base font-extrabold tracking-tight ${accepted ? "text-success" : "text-danger"}`}>
              {accepted && "KEY ACCEPTED"}
              {!accepted && data.attack_detected && "ATTACK DETECTED — KEY REJECTED"}
              {!accepted && !data.attack_detected && "KEY REJECTED"}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {accepted
                ? "Encryption gate opened — the message proceeds securely."
                : data.attack_detected
                  ? "Simulated interception raised the error rate beyond the threshold; the message is blocked."
                  : "The error rate exceeded the simulation threshold; delivery is not permitted."}
            </p>
            <div className="mt-2 flex gap-2">
              <StatusPill value={data.key_status} />
              {data.attack_detected && <StatusPill value="ATTACK_DETECTED" />}
            </div>
          </div>
        </div>
      )}

      <p className="mt-3 border-t border-border pt-2 text-[11px] text-muted">
        The acceptance threshold is a configurable <strong>simulation</strong> threshold,
        not a universal physics limit. QBER is computed by the backend from the actual run.
      </p>
    </Card>
  );
}

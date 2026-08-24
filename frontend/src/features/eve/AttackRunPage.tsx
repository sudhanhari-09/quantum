import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Card, PageHeader } from "../../components/ui/Card";
import { StatusPill } from "../../components/ui/StatusPill";
import { EmptyState, ErrorPanel, Loader } from "../../components/ui/Feedback";
import { useWs } from "../../core/wsContext";
import { useAttackStore } from "../../core/attackStore";
import { useAttack } from "../../queries/hooks";
import {
  AttackChannelVisual,
  attackPhaseFromStep,
} from "./AttackChannelVisual";

const STEPS = [
  "target acquired",
  "intercepting states",
  "eve measurement",
  "resend",
  "errors recomputed",
  "QBER recalculated",
  "security evaluation",
  "verdict",
];

/** F23 — live attack run view driven by WS attack.* + REST fallback. */
export function AttackRunPage() {
  const { communicationId } = useParams();
  const location = useLocation();
  const initialAttackId = (location.state as { attackId?: number } | null)?.attackId;
  const [attackId, setAttackId] = useState<number | undefined>(initialAttackId);
  const [progressStep, setProgressStep] = useState(initialAttackId ? STEPS.length - 1 : 0);
  const [percent, setPercent] = useState(initialAttackId ? 100 : 0);
  const subscribe = useWs();
  const navigate = useNavigate();
  const { data: attack, isError, error } = useAttack(attackId);

  // WS-driven progress while the simulation executes.
  useEffect(() => {
    return subscribe("attack.progress", (env) => {
      if (String(env.communication_id) !== communicationId) return;
      setProgressStep((s) => Math.min(s + 1, STEPS.length - 2));
      setPercent(Math.min(100, Number(env.payload?.percent ?? 0)));
    });
  }, [subscribe, communicationId]);

  useEffect(() => {
    return subscribe("attack.detected", (env) => {
      if (String(env.communication_id) !== communicationId) return;
      setProgressStep(STEPS.length - 1);
      setPercent(100);
      if (env.payload?.attack_id && attackId == null) {
        setAttackId(Number(env.payload.attack_id));
      }
    });
  }, [subscribe, communicationId, attackId]);

  useEffect(() => {
    if (attack && percent >= 100) {
      const t = window.setTimeout(
        () => navigate(`/eve/attack/result/${attack.id}`, { replace: true }),
        1200,
      );
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attack, percent]);

  if (isError)
    return <ErrorPanel message={(error as Error).message} />;

  return (
    <>
      <PageHeader
        title={`Simulated attack · session #${communicationId}`}
        subtitle="Live view of the intercept-and-resend simulation"
      />

      <div className="mb-5 max-w-2xl">
        <AttackChannelVisual
          phase={attackPhaseFromStep(progressStep, attack ? attack.detection_status === "DETECTED" : null)}
          strength={useAttackStore.getState().strength}
        />
      </div>

      {!attackId && (
        <Card className="mb-5 p-4">
          <p className="text-xs text-muted">
            Waiting for attack events…{" "}
            <Link className="text-primary hover:underline" to="/eve/active-sessions">
              back to targets
            </Link>
          </p>
        </Card>
      )}

      <Card className="max-w-2xl p-6" aria-label="Attack progress">
        <ol className="space-y-2.5">
          {STEPS.map((step, i) => {
            const state =
              i < progressStep ? "done" : i === progressStep ? "active" : "todo";
            return (
              <li key={step} className="flex items-center gap-3 text-sm">
                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-bold ${
                    state === "done"
                      ? "border-success bg-success/10 text-success"
                      : state === "active"
                        ? "animate-pulse border-danger bg-danger/10 text-danger"
                        : "border-border text-muted"
                  }`}
                >
                  {state === "done" ? "✓" : i + 1}
                </span>
                <span className={state === "todo" ? "text-muted" : ""}>{step}</span>
              </li>
            );
          })}
        </ol>

        <div
          className="mt-5 h-2 overflow-hidden rounded-full bg-slate-200"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full rounded-full transition-all duration-500 ${percent >= 100 ? "bg-danger" : "bg-danger/60"}`}
            style={{ width: `${Math.max(percent, 8)}%` }}
          />
        </div>

        <div className="mt-4 flex items-center justify-between">
          {attack ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted">verdict:</span>
              <StatusPill value={attack.detection_status === "DETECTED" ? "DETECTED" : "NOT_DETECTED"} />
            </div>
          ) : (
            <Loader label="simulating…" />
          )}
          {attack && (
            <button
              onClick={() => navigate(`/eve/attack/result/${attack.id}`)}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
            >
              Open full result →
            </button>
          )}
        </div>
      </Card>

      {!attack && attackId == null && (
        <div className="mt-5 max-w-2xl">
          <EmptyState
            title="No attack found yet"
            hint="Launch an attack from the active sessions list."
          />
        </div>
      )}
    </>
  );
}

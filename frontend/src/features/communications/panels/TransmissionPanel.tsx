import { useState } from "react";
import { Card } from "../../../components/ui/Card";
import { StatusPill } from "../../../components/ui/StatusPill";
import { Skeleton } from "../../../components/ui/Feedback";
import type { MessageStatus } from "../../../core/constants/vocab";

const SECURE_PATH: MessageStatus[] = ["PROCESSING", "ENCRYPTED", "DELIVERED", "READ"];
const ATTACK_PATH: MessageStatus[] = ["PROCESSING", "REJECTED", "BLOCKED"];

function stripState(status: MessageStatus): { idx: number; path: MessageStatus[]; done: boolean } {
  if (["BLOCKED", "REJECTED"].includes(status))
    return {
      idx: ATTACK_PATH.indexOf(status as (typeof ATTACK_PATH)[number]),
      path: ATTACK_PATH,
      done: true,
    };
  const idx = SECURE_PATH.indexOf(status);
  return { idx: Math.max(0, idx), path: SECURE_PATH, done: status === "READ" };
}

/** F14 — encryption + delivery pipeline strip. */
export function TransmissionPanel({
  status,
  protocol,
  qber,
  keyStatus,
  attackDetected,
}: {
  status?: MessageStatus;
  protocol?: string | null;
  qber?: number | null;
  keyStatus?: string | null;
  attackDetected?: boolean;
}) {
  const [showTech, setShowTech] = useState(false);

  if (!status)
    return (
      <Card className="p-5">
        <Skeleton className="h-16" />
      </Card>
    );

  const { path, idx, done } = stripState(status);
  const blocked = path === ATTACK_PATH;

  return (
    <Card className="p-5" aria-label="Transmission pipeline">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Encryption &amp; delivery
        </h3>
        <button
          onClick={() => setShowTech((v) => !v)}
          aria-expanded={showTech}
          className="text-xs text-primary hover:underline"
        >
          technical details
        </button>
      </div>

      <ol className="mt-4 flex flex-wrap items-center gap-1.5">
        {path.map((s, i) => (
          <li key={s} className="flex items-center gap-1.5">
            <span
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                blocked && s !== "PROCESSING"
                  ? "border-danger/40 bg-danger/10 text-danger"
                  : i <= idx
                    ? "border-success/40 bg-success/10 text-success"
                    : "border-border text-muted"
              }`}
            >
              {i <= idx || (blocked && s !== "PROCESSING") ? "✓" : "•"}{" "}
              {s.replace(/_/g, " ")}
            </span>
            {i < path.length - 1 && (
              <span aria-hidden="true" className={i < idx ? "text-success" : "text-border"}>
                →
              </span>
            )}
          </li>
        ))}
        {!done && <span className="ml-2 h-2 w-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />}
      </ol>

      {status === "ENCRYPTED" || status === "DELIVERED" || status === "READ" ? (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-success/10 px-2.5 py-1.5 text-xs text-success">
          🔒 Message encrypted with the accepted QKD key (AES-GCM) · protocol {protocol ?? "?"}
        </p>
      ) : null}

      {blocked && (
        <div role="alert" className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-4">
          <p className="text-sm font-semibold text-danger">Message not delivered</p>
          <p className="mt-1 text-xs text-danger/80">
            The security engine rejected the quantum key, so this message was blocked and
            will never appear in the receiver&apos;s inbox.
          </p>
        </div>
      )}

      {showTech && (
        <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted">message.status</dt>
            <dd className="mt-0.5"><StatusPill value={status} /></dd>
          </div>
          <div>
            <dt className="text-muted">key_status</dt>
            <dd className="mt-0.5"><StatusPill value={keyStatus} /></dd>
          </div>
          <div>
            <dt className="text-muted">qber</dt>
            <dd className="mt-0.5 font-mono">{qber != null ? `${(qber * 100).toFixed(2)}%` : "—"}</dd>
          </div>
          <div>
            <dt className="text-muted">attack_detected</dt>
            <dd className="mt-0.5 font-mono">{attackDetected ? "true" : "false"}</dd>
          </div>
          <p className="col-span-full text-[11px] text-muted">
            No key material is ever transmitted to or displayed by this client.
          </p>
        </dl>
      )}
    </Card>
  );
}

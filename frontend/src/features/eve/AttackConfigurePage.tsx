import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useState } from "react";
import { Card, PageHeader } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { ErrorPanel, Skeleton } from "../../components/ui/Feedback";
import { normalizeError } from "../../core/apiClient";
import { useUiStore } from "../../core/uiStore";
import { useAttackStore } from "../../core/attackStore";
import { launchAttack } from "../../queries/hooks";
import {
  ATTACK_TYPE_REGISTRY,
  STRENGTH_PRESETS,
  strengthLabel,
} from "../../core/constants/attacks";
import type { ActiveSession } from "../../types/api";

/** F22 — attack configuration with extensible type registry + strength presets. */
export function AttackConfigurePage() {
  const { communicationId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const pushToast = useUiStore((s) => s.pushToast);
  const { strength, setType, setStrength } = useAttackStore();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stateSession = (location.state as { session?: ActiveSession } | null)?.session;
  const target = stateSession ?? null;
  const selectedType = ATTACK_TYPE_REGISTRY.find((t) => t.supported)!;

  if (!target && !communicationId) {
    return <ErrorPanel message="No target selected." />;
  }

  async function submit() {
    setPending(true);
    setError(null);
    try {
      setType(selectedType.type as never);
      const attack = await launchAttack({
        communicationId: Number(communicationId),
        attack_type: selectedType.type,
        attack_strength: strength,
      });
      pushToast("success", "Attack simulation launched.");
      navigate(`/eve/attack/run/${communicationId}`, {
        state: { attackId: attack.id },
      });
    } catch (e) {
      const err = normalizeError(e);
      setError(err.message);
      if (err.code === "ATTACK_WINDOW_CLOSED") {
        pushToast("error", err.message);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Configure simulated attack"
        subtitle="Simulated interception on the idealized quantum channel"
        actions={
          <Button variant="secondary" size="sm" onClick={() => navigate("/eve/active-sessions")}>
            Back to targets
          </Button>
        }
      />
      <Card className="max-w-xl p-6">
        {target ? (
          <dl className="mb-5 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border border-border bg-slate-50/80 p-4 text-sm">
            <dt className="text-muted">Target</dt>
            <dd className="font-mono">#{target.id}</dd>
            <dt className="text-muted">Sender</dt>
            <dd>{target.sender_name}</dd>
            <dt className="text-muted">Receiver</dt>
            <dd>{target.receiver_name}</dd>
            <dt className="text-muted">Protocol</dt>
            <dd className="font-mono">{target.protocol ?? "—"}</dd>
            <dt className="text-muted">State</dt>
            <dd>{target.session_state}</dd>
          </dl>
        ) : (
          <Skeleton className="mb-5 h-24" />
        )}

        {/* §13 extensible attack-type registry */}
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Attack type</legend>
          <div className="space-y-2" role="radiogroup" aria-label="Attack type">
            {ATTACK_TYPE_REGISTRY.map((t) => (
              <label
                key={t.type}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                  t.supported && selectedType.type === t.type
                    ? "border-danger/50 bg-red-50/60"
                    : "border-border bg-surface"
                } ${!t.supported ? "opacity-55" : "hover:border-danger/40"}`}
              >
                <input
                  type="radio"
                  name="attack-type"
                  value={t.type}
                  checked={t.supported}
                  disabled={!t.supported}
                  onChange={() => t.supported && setType(t.type as never)}
                  className="mt-0.5 accent-red-600"
                />
                <span>
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {t.label}
                    {!t.supported && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted">
                        future release
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted">{t.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* §14 strength presets + slider */}
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <span id="strength-label" className="text-sm font-medium">
              Attack strength
            </span>
            <span className="rounded-full border border-danger/30 bg-red-50 px-2.5 py-0.5 text-[11px] font-bold text-danger">
              {strengthLabel(strength)} · intercept {(strength * 100).toFixed(0)}%
            </span>
          </div>

          <div className="mb-3 grid grid-cols-3 gap-2" role="group" aria-labelledby="strength-label">
            {STRENGTH_PRESETS.map((p) => {
              const activePreset = Math.abs(strength - p.value) < 0.03;
              return (
                <button
                  key={p.key}
                  type="button"
                  title={p.hint}
                  onClick={() => setStrength(p.value)}
                  aria-pressed={activePreset}
                  className={`rounded-lg border px-2 py-2 text-xs font-bold transition ${
                    activePreset
                      ? "border-danger bg-danger text-white shadow-sm"
                      : "border-border text-muted hover:border-danger/40 hover:text-danger"
                  }`}
                >
                  {p.key}
                </button>
              );
            })}
          </div>

          <input
            id="strength-slider"
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={strength}
            onChange={(e) => setStrength(Number(e.target.value))}
            aria-valuetext={`${strengthLabel(strength)}, ${(strength * 100).toFixed(0)} percent`}
            className="w-full accent-red-600"
          />
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Higher strength corrupts more qubits and raises the post-attack error rate.
            The impact you see always comes from the backend rerun — never from the UI.
          </p>
        </div>

        {error && (
          <div role="alert" className="mt-4 rounded-md border border-danger/40 bg-red-50 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => window.history.back()}>
            Cancel
          </Button>
          <Button variant="danger" loading={pending} onClick={() => void submit()}>
            Launch simulated attack
          </Button>
        </div>
      </Card>
    </>
  );
}

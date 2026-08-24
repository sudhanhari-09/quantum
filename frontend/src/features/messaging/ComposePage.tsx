import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, PageHeader } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { ErrorPanel, Loader } from "../../components/ui/Feedback";
import { useUiStore } from "../../core/uiStore";
import { QSC_ID_REGEX } from "../../core/constants/vocab";
import { useComposeStore } from "../../core/composeStore";
import { normalizeError } from "../../core/apiClient";
import { searchUsers, useSendMessage } from "../../queries/hooks";
import type { UserPublic } from "../../types/api";

/** F7 — debounced type-ahead QSC-ID search (step 1 of the wizard). */
function ReceiverSearch() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<UserPublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setReceiver = useComposeStore((s) => s.setReceiver);
  const nextStep = useComposeStore((s) => s.nextStep);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  function onChange(v: string) {
    setQuery(v.toUpperCase());
    setResult(null);
    setError(null);
    if (timer.current) window.clearTimeout(timer.current);
    const id = v.trim().toUpperCase();
    if (!QSC_ID_REGEX.test(id)) return;
    timer.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchUsers(id);
        setResult(res.user);
      } catch (e) {
        const err = normalizeError(e);
        setError(err.message);
        setResult(null);
      } finally {
        setSearching(false);
      }
    }, 350);
  }

  const valid = result != null;

  return (
    <div>
      <label className="mb-1 block text-sm font-medium">Receiver QSC ID</label>
      <input
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="QSC-XXXXXXXXXX"
        aria-label="Receiver QSC ID"
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-md border border-border bg-slate-50 px-3 py-2 font-mono text-sm outline-none focus:border-primary"
      />
      <p className="mt-1 text-xs text-muted">
        Format: QSC- followed by exactly 10 letters/digits.
      </p>
      {searching && (
        <div className="mt-3">
          <Loader label="Looking up receiver…" />
        </div>
      )}
      {!searching && error && (
        <div role="alert" className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}
      {!searching && query && !valid && !error && QSC_ID_REGEX.test(query) === false && query.length > 4 && (
        <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          Keep typing — ID format is not complete yet.
        </div>
      )}
      {valid && result && (
        <Card className="mt-3 flex items-center gap-3 p-4">
          <div>
            <p className="text-sm font-semibold">{result.name}</p>
            <p className="font-mono text-xs text-muted">{result.unique_user_id}</p>
          </div>
          <Button
            className="ml-auto"
            size="sm"
            onClick={() => {
              setReceiver(result);
              nextStep();
            }}
          >
            Select receiver
          </Button>
        </Card>
      )}
    </div>
  );
}

const LIMIT = 2000;

/** F8 — compose wizard: search → message + security level → review → send. */
export function ComposePage() {
  const navigate = useNavigate();
  const pushToast = useUiStore((s) => s.pushToast);
  const { step, receiver, body, securityLevel, setBody, setSecurityLevel, prevStep, reset } =
    useComposeStore();
  const mutation = useSendMessage();

  const remaining = LIMIT - body.length;
  const canSubmit =
    receiver != null && body.trim().length > 0 && body.length <= LIMIT;

  function submit() {
    if (!receiver) return;
    mutation.mutate(
      {
        receiver_qsc_id: receiver.unique_user_id,
        content: body.trim(),
        security_requirement: securityLevel,
      },
      {
        onSuccess: ({ communication_id }) => {
          pushToast("success", "Message accepted for secure processing.");
          reset();
          navigate(`/communications/${communication_id}`);
        },
        onError: (e) => {
          const err = normalizeError(e);
          pushToast("error", err.message);
        },
      },
    );
  }

  return (
    <>
      <PageHeader
        title="Compose secure message"
        subtitle="The backend will run AI protocol selection and simulated QKD after you submit"
      />
      {/* Step dots */}
      <ol className="mb-6 flex items-center gap-2" aria-label="Compose steps">
        {["Receiver", "Message", "Review"].map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={step === i + 1 ? "step" : undefined}
              className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold ${
                step === i + 1
                  ? "border-primary bg-primary/10 text-primary"
                  : step > i + 1
                    ? "border-success bg-success/10 text-success"
                    : "border-border text-muted"
              }`}
            >
              {i + 1}
            </span>
            <span className={`text-xs ${step === i + 1 ? "text-fg" : "text-muted"}`}>
              {label}
            </span>
            {i < 2 && <span aria-hidden="true" className="mx-1 text-muted">—</span>}
          </li>
        ))}
      </ol>

      <Card className="max-w-2xl p-6">
        {step === 1 && <ReceiverSearch />}

        {step === 2 && (
          <div>
            <p className="mb-4 rounded-md bg-slate-50 px-3 py-2 text-sm">
              To:{" "}
              <span className="font-medium">{receiver?.name}</span>{" "}
              <span className="font-mono text-xs text-muted">
                {receiver?.unique_user_id}
              </span>
            </p>
            <label htmlFor="msg-body" className="mb-1 block text-sm font-medium">
              Message
            </label>
            <textarea
              id="msg-body"
              rows={6}
              value={body}
              maxLength={LIMIT}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type your secret message…"
              className="w-full resize-y rounded-md border border-border bg-slate-50 px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <p className={`mt-1 text-xs ${remaining < 100 ? "text-warning" : "text-muted"}`}>
              {remaining} characters left
            </p>

            <fieldset className="mt-5">
              <legend className="mb-2 text-sm font-medium">Security requirement</legend>
              <div className="flex gap-2">
                {(["LOW", "MEDIUM", "HIGH"] as const).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setSecurityLevel(lvl)}
                    aria-pressed={securityLevel === lvl}
                    className={`rounded-md border px-4 py-2 text-xs font-semibold ${
                      securityLevel === lvl
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted hover:text-fg"
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted">
                Feeds the AI recommendation engine; it never overrides the backend decision.
              </p>
            </fieldset>

            <div className="mt-6 flex gap-2">
              <Button variant="secondary" onClick={prevStep}>
                Back
              </Button>
              <Button disabled={!canSubmit} onClick={() => useComposeStore.getState().nextStep()}>
                Review
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Review
            </h3>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Receiver</dt>
                <dd>
                  {receiver?.name}{" "}
                  <span className="font-mono text-xs">{receiver?.unique_user_id}</span>
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Security requirement</dt>
                <dd>{securityLevel}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Length</dt>
                <dd>{body.length} chars</dd>
              </div>
            </dl>
            <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-slate-50 p-3 text-sm">
              {body}
            </pre>
            <div className="mt-6 flex gap-2">
              <Button variant="secondary" onClick={prevStep}>
                Back
              </Button>
              <Button loading={mutation.isPending} disabled={!canSubmit} onClick={submit}>
                Send securely
              </Button>
            </div>
          </div>
        )}
      </Card>
      {mutation.isError && (
        <div className="mt-4 max-w-2xl">
          <ErrorPanel message={(mutation.error as { message: string }).message} />
        </div>
      )}
    </>
  );
}

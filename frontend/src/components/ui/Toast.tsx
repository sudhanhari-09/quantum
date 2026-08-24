import { useUiStore } from "../../core/uiStore";

const kindClass = {
  success: "border-success/40 bg-success/10 text-success",
  error: "border-danger/40 bg-danger/10 text-danger",
  info: "border-primary/40 bg-primary/10 text-primary",
} as const;

/** Toast/notification center (F2/F32). */
export function Toaster() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-lg ${kindClass[t.kind]}`}
        >
          <div className="flex items-start justify-between gap-2">
            <span>{t.message}</span>
            <button
              aria-label="Dismiss notification"
              className="opacity-60 hover:opacity-100"
              onClick={() => dismiss(t.id)}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

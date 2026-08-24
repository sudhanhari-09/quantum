import {
  COMM_STATES,
  STATE_GROUPS,
  TERMINAL_STATES,
  type CommState,
  type StateGroup,
} from "../../core/constants/vocab";

const groupColor: Record<StateGroup, string> = {
  preparation: "bg-primary",
  qkd: "bg-cyan-400",
  security: "bg-warning",
  secure: "bg-success",
  attack: "bg-danger",
  failure: "bg-slate-500",
};

/** Auto-built from the 18-state vocabulary; current state highlighted (F2). */
export function StateStepper({ current }: { current: CommState | null }) {
  const idx = current ? COMM_STATES.indexOf(current) : -1;
  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Communication state">
      {COMM_STATES.filter((s) => s !== "FAILED" || current === "FAILED").map(
        (state) => {
          const i = COMM_STATES.indexOf(state);
          const done = idx >= 0 && i < idx;
          const active = state === current;
          const terminal = TERMINAL_STATES.includes(state) && !active && !done;
          return (
            <li key={state}>
              <span
                className={[
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                  active
                    ? "border-fg bg-fg/10 text-fg"
                    : done
                      ? "border-border bg-surface text-muted"
                      : "border-border/50 bg-transparent text-muted/50",
                ].join(" ")}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${
                    terminal ? "bg-muted/30" : groupColor[STATE_GROUPS[state]]
                  } ${active ? "animate-pulse" : ""}`}
                />
                {state.replace(/_/g, " ")}
              </span>
            </li>
          );
        },
      )}
    </ol>
  );
}

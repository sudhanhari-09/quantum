import type { ReactNode } from "react";
import { useUiStore } from "../../core/uiStore";

export function LiveIndicator() {
  const wsStatus = useUiStore((s) => s.wsStatus);
  const color =
    wsStatus === "connected"
      ? "bg-success"
      : wsStatus === "connecting"
        ? "bg-warning"
        : "bg-danger";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted"
      role="status"
      aria-label={`Live connection ${wsStatus}`}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${color} ${
          wsStatus === "connected" ? "animate-pulse" : ""
        }`}
      />
      {wsStatus}
    </span>
  );
}

export function ReconnectBanner() {
  const wsStatus = useUiStore((s) => s.wsStatus);
  if (wsStatus !== "disconnected") return null;
  return (
    <div
      role="alert"
      className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning"
    >
      Live connection lost — showing last known data and retrying…
    </div>
  );
}

export function ErrorBoundaryFallback({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div role="alert" className="m-8 rounded-xl border border-danger/40 bg-danger/5 p-6">
      <h1 className="text-lg font-semibold text-danger">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">
        An unexpected client error occurred. Details are logged for developers.
      </p>
      <button
        className="mt-4 rounded-md border border-border px-3 py-1.5 text-sm hover:border-primary"
        onClick={reset}
      >
        Try again
      </button>
      <pre className="mt-4 hidden overflow-auto rounded bg-slate-50 p-3 text-xs text-muted">
        {error.message}
      </pre>
    </div>
  );
}

export function Boundary({ children }: { children: ReactNode }) {
  // Simple boundary implementation without class component (React 18 function-friendly).
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

// Minimal error boundary using componentDidCatch via class is unavoidable in React;
// kept tiny and centralized.
import { Component } from "react";

interface EBState {
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { error: null };

  static getDerivedStateFromError(error: Error): EBState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[QSC] Unhandled UI error:", error.message);
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorBoundaryFallback
          error={this.state.error}
          reset={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}

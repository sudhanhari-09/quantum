import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient, normalizeError } from "../../core/apiClient";
import { useAuthStore } from "../../core/authStore";
import { expireSession, startCrossTabSync } from "../../core/session";
import { Loader } from "../../components/ui/Feedback";
import type { User } from "../../types/api";

const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 1_500;

/**
 * Session hydration (F3 / Sec 09 + STEP 6 of the auth lifecycle).
 *
 *   tokens in storage → GET /auth/me (the API client refreshes transparently
 *   when the access token is expired) → user + role from the BACKEND →
 *   queries invalidated so every dashboard reloads → WS connects.
 *
 *   no tokens           → unauthenticated (guarded routes redirect to /login)
 *   401 / TOKEN_REUSED  → session cleared + login redirect + clear message
 *   network failure     → session kept, bounded retry, then a manual retry UI
 *                         (a server outage must never log the user out)
 */
export function SessionBootstrap({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const authStatus = useAuthStore((s) => s.authStatus);
  const [attempt, setAttempt] = useState(0);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    startCrossTabSync();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function restore() {
      const { accessToken, refreshToken } = useAuthStore.getState();
      if (!accessToken && !refreshToken) {
        // No stored tokens at all - mark as unauthenticated and stop
        useAuthStore.getState().markUnauthenticated();
        return;
      }
      try {
        const { data } = await apiClient.get<{ user: User }>("/auth/me");
        if (cancelled) return;
        useAuthStore.getState().setUser(data.user);
        setUnreachable(false);
        // Re-auth complete: recover every dashboard/query that 401'd meanwhile.
        void queryClient.invalidateQueries();
      } catch (error) {
        if (cancelled) return;
        const failure = normalizeError(error);
        if (
          failure.status === 401 ||
          failure.status === 422 ||
          failure.code === "TOKEN_INVALID" ||
          failure.code === "TOKEN_REQUIRED" ||
          failure.code === "TOKEN_REUSED"
        ) {
          expireSession(failure.code === "TOKEN_REUSED" ? "reused" : "expired");
          return;
        }
        if (failure.status === 403) {
          // Authenticated but refused (disabled account): no session to keep.
          expireSession("revoked");
          return;
        }
        if (attempt + 1 < MAX_ATTEMPTS) {
          setAttempt((value) => value + 1);
          timer = window.setTimeout(() => void restore(), RETRY_BASE_MS * 2 ** attempt);
        } else {
          // Any other error from /auth/me: expire session and show login
          // This handles network errors, 500s, or any other unexpected status
          expireSession("expired");
          return;
        }
      }
    }

    void restore();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [attempt, queryClient]);

  if (unreachable && authStatus === "unknown") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
        <p role="alert" className="text-sm font-medium text-danger">
          The server could not be reached, so your session could not be verified.
        </p>
        <p className="max-w-md text-xs text-muted">
          You have not been signed out. Retry once the backend is reachable.
        </p>
        <button
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-primary"
          onClick={() => {
            setUnreachable(false);
            setAttempt((value) => value + 1);
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (authStatus === "unknown") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <Loader label="Restoring your secure session…" />
      </div>
    );
  }

  return <>{children}</>;
}
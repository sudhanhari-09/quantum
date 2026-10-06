import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, useNavigate } from "react-router-dom";
import { Toaster } from "./components/ui/Toast";
import { Boundary } from "./components/ui/FeedbackGlobal";
import { AppRoutes } from "./routes";
import { WsProvider } from "./core/wsContext";
import { useLiveInvalidation } from "./queries/live";
import { useAuthStore } from "./core/authStore";
import { useUiStore } from "./core/uiStore";
import {
  onSessionEnd,
  onSessionRefreshed,
  SESSION_END_MESSAGES,
  type SessionEndReason,
} from "./core/session";
import { SessionBootstrap } from "./features/auth/SessionBootstrap";

/**
 * TanStack Query retry policy.
 *
 * Auth (401), authorization (403), not-found (404), validation (422) and rate
 * limiting (429) answers are FINAL — retrying them only multiplies traffic and
 * can double-fire the refresh flow. Only transient/network failures retry once.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status = (error as { status?: number } | null)?.status;
        if (status === 401 || status === 403 || status === 404 || status === 422 || status === 429) {
          return false;
        }
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
  },
});

/** Set by the module-level listener, consumed once by SessionWatcher. */
let pendingSessionEnd: SessionEndReason | null = null;

// Registered at import time so a session that dies during app boot is still
// reported (and still redirects) exactly once.
onSessionEnd((reason) => {
  pendingSessionEnd = reason;
  useUiStore.getState().pushToast("error", SESSION_END_MESSAGES[reason]);
});

// A successful refresh means previously failed queries can recover by
// themselves (dashboard/active-communications/live views).
onSessionRefreshed(() => {
  void queryClient.invalidateQueries();
});

/** Mounts the single WS event -> invalidation wiring (F31). */
function LiveBridge() {
  useLiveInvalidation();
  return null;
}

/** Sends the user to /login (with a reason banner) when a session ends. */
function SessionWatcher() {
  const navigate = useNavigate();
  const authStatus = useAuthStore((s) => s.authStatus);

  useEffect(() => {
    if (authStatus !== "unauthenticated" || !pendingSessionEnd) return;
    const reason = pendingSessionEnd;
    pendingSessionEnd = null;
    navigate("/login", { replace: true, state: { sessionEnded: reason } });
  }, [authStatus, navigate]);

  return null;
}

export default function Providers() {
  return (
    <QueryClientProvider client={queryClient}>
      <WsProvider>
        <BrowserRouter>
          <Boundary>
            <SessionBootstrap>
              <SessionWatcher />
              <LiveBridge />
              <AppRoutes />
            </SessionBootstrap>
          </Boundary>
        </BrowserRouter>
        <Toaster />
      </WsProvider>
    </QueryClientProvider>
  );
}

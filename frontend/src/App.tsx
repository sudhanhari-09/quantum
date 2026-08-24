import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "./components/ui/Toast";
import { Boundary } from "./components/ui/FeedbackGlobal";
import { AppRoutes } from "./routes";
import { WsProvider } from "./core/wsContext";
import { useLiveInvalidation } from "./queries/live";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
  },
});

/** Mounts the single WS event -> invalidation wiring (F31). */
function LiveBridge() {
  useLiveInvalidation();
  return null;
}

export default function Providers() {
  return (
    <QueryClientProvider client={queryClient}>
      <WsProvider>
        <BrowserRouter>
          <Boundary>
            <LiveBridge />
            <AppRoutes />
          </Boundary>
        </BrowserRouter>
        <Toaster />
      </WsProvider>
    </QueryClientProvider>
  );
}

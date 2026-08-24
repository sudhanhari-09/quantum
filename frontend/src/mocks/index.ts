import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";
import { seedMockData } from "./engine";
import { installMockWebSocket } from "./socket";

export const worker = setupWorker(...handlers);

/** Boot MSW + the simulated WS transport. Dev/demo/test only. */
export async function enableMocks(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  await worker.start({
    onUnhandledRequest: "bypass",
    quiet: true,
    serviceWorker: { url: "/mockServiceWorker.js" },
  });
  installMockWebSocket();
  seedMockData();
}

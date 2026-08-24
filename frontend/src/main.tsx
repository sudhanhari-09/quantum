import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ENABLE_MOCKS } from "./core/config";
import "./index.css";

async function boot() {
  if (ENABLE_MOCKS) {
    const { enableMocks } = await import("./mocks");
    await enableMocks();
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();

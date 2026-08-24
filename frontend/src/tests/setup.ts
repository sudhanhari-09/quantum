import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll, afterAll, vi } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "../mocks/handlers";
import { seedMockData, db } from "../mocks/engine";

export const server = setupServer(...handlers);

beforeAll(async () => {
  // jsdom lacks matchMedia
  window.matchMedia =
    window.matchMedia ||
    (() =>
      ({
        matches: false,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList);
  server.listen({ onUnhandledRequest: "warn" });
  seedMockData();
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => server.close());

export { db };

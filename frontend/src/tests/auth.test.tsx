import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { LoginPage } from "../features/auth/LoginPage";
import { RegisterPage } from "../features/auth/RegisterPage";
import { db } from "./setup";
import { useAuthStore } from "../core/authStore";

function withProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/login"]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** password inputs carry no ARIA textbox role; select them by type */
function passwordInputs() {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'));
}

describe("auth flows (F3) against the contract mock", () => {
  it("logs in a seeded user and stores the session", async () => {
    const user = userEvent.setup();
    withProviders(<LoginPage />);
    await user.type(screen.getByLabelText(/email/i), "alice@qsc.dev");
    await user.type(screen.getByLabelText(/^password/i), "password123");
    const btn = screen.getByRole("button", { name: /sign in/i });
    await user.click(btn);
    // session persisted into authStore; no error banner shown
    await vi.waitFor(() =>
      expect(useAuthStore.getState().accessToken).not.toBeNull(),
    );
    expect(useAuthStore.getState().user?.name).toBe("Alice");
    expect(useAuthStore.getState().user?.role).toBe("USER");
    expect(db.users.find((u) => u.email === "alice@qsc.dev")?.role).toBe("USER");
  });

  it("renders a friendly message for invalid credentials", async () => {
    const user = userEvent.setup();
    withProviders(<LoginPage />);
    await user.type(screen.getByLabelText(/email/i), "alice@qsc.dev");
    await user.type(screen.getByLabelText(/^password/i), "wrong-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /incorrect email or password/i,
    );
  });

  it("validates password confirmation client-side before any request", async () => {
    const user = userEvent.setup();
    withProviders(<RegisterPage />);
    await user.type(screen.getByLabelText(/full name/i), "Tina");
    await user.type(screen.getByLabelText(/email/i), "tina@qsc.dev");
    const [password, confirm] = passwordInputs();
    await user.type(password!, "longenough1");
    await user.type(confirm!, "mismatch99");
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
  });
});

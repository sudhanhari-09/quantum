import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { UserDashboard } from "../features/dashboard/UserDashboard";
import { InboxPage, SentPage } from "../features/messaging/MessageListPages";
import { EveDashboard } from "../features/eve/EveDashboard";
import { AdminUsersPage, AdminAuditPage } from "../features/admin/AdminPages";
import { ProfilePage } from "../features/profile/ProfilePage";
import { HistoryPage } from "../features/messaging/HistoryPage";
import { SecurityReportsPage } from "../features/reports/SecurityReportsPage";
import { useAuthStore } from "../core/authStore";
import { db } from "./setup";

function mount(ui: React.ReactElement, route = "/") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function loginAs(email: string) {
  const user = db.users.find((u) => u.email === email)!;
  useAuthStore.getState().setSession(user, `mock-access-${user.id}-${Date.now()}`, "refresh");
  return user;
}

describe("role pages render live backend data (F5/F15/F20/F27)", () => {
  beforeEach(() => {
    useAuthStore.getState().clearSession();
  });

  it("USER dashboard shows summary stat cards", async () => {
    loginAs("alice@qsc.dev");
    mount(<UserDashboard />);
    expect(await screen.findByText(/messages sent/i)).toBeInTheDocument();
    expect(await screen.findByText(/average qber/i)).toBeInTheDocument();
  });

  it("USER inbox shows empty state before any delivery", async () => {
    loginAs("alice@qsc.dev");
    mount(<InboxPage />);
    expect(await screen.findByText(/no messages yet/i)).toBeInTheDocument();
  });

  it("USER sent list shows empty state", async () => {
    loginAs("bob@qsc.dev");
    mount(<SentPage />);
    expect(await screen.findByText(/no sent messages yet/i)).toBeInTheDocument();
  });

  it("USER history page renders table skeleton then empty state", async () => {
    loginAs("bob@qsc.dev");
    mount(<HistoryPage />);
    expect(await screen.findByText(/no communications yet/i)).toBeInTheDocument();
  });

  it("profile shows the QSC ID chip", async () => {
    const user = loginAs("alice@qsc.dev");
    mount(<ProfilePage />);
    expect(await screen.findByText(user.unique_user_id)).toBeInTheDocument();
  });

  it("security reports empty state", async () => {
    loginAs("alice@qsc.dev");
    mount(<SecurityReportsPage />);
    expect(await screen.findByText(/no reports yet/i)).toBeInTheDocument();
  });

  it("EVE dashboard greets with simulated-role banner", async () => {
    loginAs("eve@qsc.dev");
    mount(<EveDashboard />);
    expect(await screen.findByText(/simulated attacker zone/i)).toBeInTheDocument();
    expect(await screen.findByText(/no active sessions eligible/i)).toBeInTheDocument();
  });

  it("ADMIN users page lists seeded accounts", async () => {
    loginAs("admin@qsc.dev");
    mount(<AdminUsersPage />);
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Eve")).toBeInTheDocument();
  });

  it("ADMIN audit page shows seed entry", async () => {
    loginAs("admin@qsc.dev");
    mount(<AdminAuditPage />);
    expect(await screen.findByText(/demo accounts provisioned/i)).toBeInTheDocument();
  });
});

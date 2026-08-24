import { Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "./features/auth/LoginPage";
import { RegisterPage } from "./features/auth/RegisterPage";
import { RequireAuth } from "./features/auth/RequireAuth";
import { ZoneLayout } from "./features/layout/ZoneLayout";
import { AboutQkdPage, ForbiddenPage } from "./features/StaticPages";
import { UserDashboard } from "./features/dashboard/UserDashboard";
import { ProfilePage } from "./features/profile/ProfilePage";
import { ComposePage } from "./features/messaging/ComposePage";
import { InboxPage, SentPage } from "./features/messaging/MessageListPages";
import { MessageDetailPage } from "./features/messaging/MessageDetailPage";
import { HistoryPage } from "./features/messaging/HistoryPage";
import {
  MessageSecurityReportPage,
  SecurityReportsPage,
} from "./features/reports/SecurityReportsPage";
import { CommunicationDetailPage } from "./features/communications/CommunicationDetailPage";
import { LandingPage } from "./features/landing/LandingPage";
import { QkdSimulationsPage } from "./features/dashboard/QkdSimulationsPage";
import {
  AdminCommunicationsPage,
  AdminAttacksPage,
} from "./features/admin/AdminAnalyticsPages";
import {
  ActiveSessionsPage,
  EveDashboard,
} from "./features/eve/EveDashboard";
import { AttackConfigurePage } from "./features/eve/AttackConfigurePage";
import { AttackRunPage } from "./features/eve/AttackRunPage";
import { AttackResultPage } from "./features/eve/AttackResultPage";
import { EveAttackHistoryPage } from "./features/eve/EveAttackHistoryPage";
import { AdminDashboard } from "./features/admin/AdminDashboard";
import {
  AdminAttackersPage,
  AdminAuditPage,
  AdminProtocolsPage,
  AdminSecurityPage,
  AdminUsersPage,
} from "./features/admin/AdminPages";

export function AppRoutes() {
  return (
    <Routes>
      {/* PUBLIC */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/about-qkd" element={<AboutQkdPage />} />
      <Route path="/forbidden" element={<ForbiddenPage />} />

      {/* USER zone */}
      <Route
        element={
          <RequireAuth roles={["USER"]}>
            <ZoneLayout />
          </RequireAuth>
        }
        path="/"
      >
        <Route path="dashboard" element={<UserDashboard />} />
        <Route path="qkd" element={<QkdSimulationsPage />} />
        <Route path="messages/compose" element={<ComposePage />} />
        <Route path="messages/:id" element={<MessageDetailPage />} />
        <Route path="messages/:id/security-report" element={<MessageSecurityReportPage />} />
        <Route path="communications/:communicationId" element={<CommunicationDetailPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="sent" element={<SentPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="security-reports" element={<SecurityReportsPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>

      {/* ATTACKER zone */}
      <Route
        element={
          <RequireAuth roles={["ATTACKER"]}>
            <ZoneLayout />
          </RequireAuth>
        }
        path="/eve"
      >
        <Route path="dashboard" element={<EveDashboard />} />
        <Route path="active-sessions" element={<ActiveSessionsPage />} />
        <Route path="attack/configure/:communicationId" element={<AttackConfigurePage />} />
        <Route path="attack/run/:communicationId" element={<AttackRunPage />} />
        <Route path="attack/result/:attackId" element={<AttackResultPage />} />
        <Route path="attack/history" element={<EveAttackHistoryPage />} />
      </Route>

      {/* ADMIN zone */}
      <Route
        element={
          <RequireAuth roles={["ADMIN"]}>
            <ZoneLayout />
          </RequireAuth>
        }
        path="/admin"
      >
        <Route path="dashboard" element={<AdminDashboard />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="communications" element={<AdminCommunicationsPage />} />
        <Route path="attacks" element={<AdminAttacksPage />} />
        <Route path="attackers" element={<AdminAttackersPage />} />
        <Route path="security" element={<AdminSecurityPage />} />
        <Route path="protocols" element={<AdminProtocolsPage />} />
        <Route path="audit" element={<AdminAuditPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

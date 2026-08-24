import { useMutation, useQuery } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost } from "../core/apiClient";
import type {
  ActiveSession,
  AdminDashboardSummary,
  AttackRow,
  AuditRow,
  CommunicationSummary,
  EveDashboardSummary,
  MessageDetail,
  MessageRow,
  ProtocolAnalyticsRow,
  ProtocolRegistryEntry,
  QkdRun,
  Recommendation,
  SecurityEventRow,
  SecurityReport,
  SecurityState,
  TimelineEvent,
  User,
  UserDashboardSummary,
} from "../types/api";

// ---- dashboard ---------------------------------------------------------
export function useDashboardSummary() {
  return useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: () => apiGet<UserDashboardSummary>("/dashboard/summary"),
  });
}

// ---- users / profile ----------------------------------------------------
export function useMyProfile(enabled = true) {
  return useQuery({
    queryKey: ["users", "me"],
    queryFn: () => apiGet<User>("/users/me"),
    enabled,
  });
}

export function searchUsers(qscId: string) {
  return apiGet<{ user: { id: number; name: string; unique_user_id: string } }>(
    "/users/search",
    { qsc_id: qscId },
  );
}

// ---- messaging -----------------------------------------------------------
export function sendMessage(input: {
  receiver_qsc_id: string;
  content: string;
  security_requirement?: string;
}) {
  return apiPost<{ message_id: number; communication_id: number }>("/messages", input);
}

export function useSendMessage() {
  return useMutation({ mutationFn: sendMessage });
}

function list<T>(url: string, page: number, extra?: Record<string, string>) {
  return apiGet<{ items: T[]; total: number; page: number; limit: number }>(url, {
    page,
    limit: 20,
    ...extra,
  });
}

export function useInbox(page = 1) {
  return useQuery({
    queryKey: ["messages", "inbox", page],
    queryFn: () => list<MessageRow>("/messages/inbox", page),
  });
}

export function useSent(page = 1) {
  return useQuery({
    queryKey: ["messages", "sent", page],
    queryFn: () => list<MessageRow>("/messages/sent", page),
  });
}

export function useMessage(id: number | undefined) {
  return useQuery({
    queryKey: ["messages", id],
    queryFn: () => apiGet<MessageDetail>(`/messages/${id}`),
    enabled: id != null,
    retry: false,
  });
}

// ---- communications ---------------------------------------------------
export function useCommunication(id: number | undefined) {
  return useQuery({
    queryKey: ["communications", id],
    queryFn: () => apiGet<CommunicationSummary>(`/communications/${id}`),
    enabled: id != null,
    retry: false,
  });
}

export function useCommunications(scope: "mine" | "history" = "history") {
  return useQuery({
    queryKey: ["communications", scope],
    queryFn: () =>
      list<CommunicationSummary>("/communications", 1, { scope }),
  });
}

export function useActiveSessions(enabled = true) {
  return useQuery({
    queryKey: ["communications", "active"],
    queryFn: () => apiGet<{ items: ActiveSession[] }>("/communications/active"),
    enabled,
  });
}

export function useRecommendation(communicationId: number | undefined) {
  return useQuery({
    queryKey: ["recommendation", communicationId],
    queryFn: () =>
      apiGet<Recommendation>(`/communications/${communicationId}/recommendation`),
    enabled: communicationId != null,
    retry: false,
  });
}

export function useQkdRuns(communicationId: number | undefined) {
  return useQuery({
    queryKey: ["qkd", communicationId],
    queryFn: () =>
      apiGet<{ runs: QkdRun[]; latest_key_status: string }>(
        `/communications/${communicationId}/qkd`,
        { include_sample: true },
      ),
    enabled: communicationId != null,
  });
}

export function useSecurityState(communicationId: number | undefined) {
  return useQuery({
    queryKey: ["security", communicationId],
    queryFn: () => apiGet<SecurityState>(`/communications/${communicationId}/security`),
    enabled: communicationId != null,
  });
}

export function useTimeline(communicationId: number | undefined) {
  return useQuery({
    queryKey: ["timeline", communicationId],
    queryFn: () =>
      apiGet<{ events: TimelineEvent[] }>(`/communications/${communicationId}/timeline`),
    enabled: communicationId != null,
  });
}

// ---- attacks (EVE) ------------------------------------------------------
export function launchAttack(input: {
  communicationId: number;
  attack_type: string;
  attack_strength: number;
}) {
  const { communicationId, ...body } = input;
  return apiPost<AttackRow>(`/communications/${communicationId}/attacks`, body);
}

export function useAttack(attackId: number | undefined) {
  return useQuery({
    queryKey: ["attacks", attackId],
    queryFn: () => apiGet<AttackRow>(`/attacks/${attackId}`),
    enabled: attackId != null,
    retry: false,
  });
}

export function useAttackHistory() {
  return useQuery({
    queryKey: ["attacks", "history"],
    queryFn: () => list<AttackRow>("/attacks/history", 1),
  });
}

export function useEveSummary() {
  return useQuery({
    queryKey: ["eve", "summary"],
    queryFn: () => apiGet<EveDashboardSummary>("/eve/dashboard/summary"),
  });
}

// ---- reports -----------------------------------------------------------
export function useSecurityReports() {
  return useQuery({
    queryKey: ["reports", "security"],
    queryFn: () => list<SecurityReport>("/security-reports", 1),
  });
}

export function useSecurityReport(messageId: number | undefined) {
  return useQuery({
    queryKey: ["reports", "security", messageId],
    queryFn: () =>
      apiGet<{ report: SecurityReport }>(`/messages/${messageId}/security-report`),
    enabled: messageId != null,
    retry: false,
  });
}

// ---- admin -------------------------------------------------------------
export function useAdminSummary() {
  return useQuery({
    queryKey: ["admin", "summary"],
    queryFn: () => apiGet<AdminDashboardSummary>("/admin/dashboard/summary"),
  });
}

export function useAdminUsers(search: string) {
  return useQuery({
    queryKey: ["admin", "users", search],
    queryFn: () => list<User>("/admin/users", 1, { search }),
  });
}

export function setUserActive(userId: number, is_active: boolean) {
  return apiPatch<User>(`/admin/users/${userId}`, { is_active });
}

export function useAdminSecurityEvents() {
  return useQuery({
    queryKey: ["admin", "security-events"],
    queryFn: () => list<SecurityEventRow>("/admin/security-events", 1),
  });
}

export function useProtocolAnalytics() {
  return useQuery({
    queryKey: ["admin", "protocol-analytics"],
    queryFn: () =>
      apiGet<{ protocols: ProtocolAnalyticsRow[]; by_day: { date: string; count: number }[] }>(
        "/admin/protocol-analytics",
      ),
  });
}

export function useAuditLogs() {
  return useQuery({
    queryKey: ["admin", "audit-logs"],
    queryFn: () => list<AuditRow>("/admin/audit-logs", 1),
  });
}

export function useProtocols() {
  return useQuery({
    queryKey: ["protocols"],
    queryFn: () => apiGet<ProtocolRegistryEntry[]>("/protocols"),
    staleTime: 300_000,
  });
}

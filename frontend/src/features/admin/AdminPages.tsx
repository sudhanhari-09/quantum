import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../components/ui/Card";
import { Table, Td, Tr } from "../../components/ui/Table";
import { Badge } from "../../components/ui/StatusPill";
import {
  ConfirmDialog,
} from "../../components/ui/Modal";
import { EmptyState, ErrorPanel, TableSkeleton } from "../../components/ui/Feedback";
import { useAdminUsers, setUserActive, useAuditLogs, useAdminSecurityEvents, useProtocolAnalytics, useProtocols } from "../../queries/hooks";
import { normalizeError } from "../../core/apiClient";
import { useUiStore } from "../../core/uiStore";
import type { User } from "../../types/api";

/** F27 — user management with search + enable/disable. */
export function AdminUsersPage() {
  const [search, setSearch] = useState("");
  const [confirmUser, setConfirmUser] = useState<User | null>(null);
  const qc = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const { data, isPending, isError, error, refetch } = useAdminUsers(search);

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      setUserActive(id, active),
    onSuccess: (_, vars) => {
      pushToast("success", `User ${vars.active ? "enabled" : "disabled"}.`);
      setConfirmUser(null);
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (e) => {
      pushToast("error", normalizeError(e).message);
      setConfirmUser(null);
    },
  });

  if (isError)
    return <ErrorPanel message={(error as Error).message} onRetry={() => refetch()} />;
  const rows = data?.items ?? [];

  return (
    <>
      <PageHeader title="Users" subtitle="Search, inspect and enable/disable platform users" />
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name, email or QSC ID…"
        aria-label="Search users"
        className="mb-4 w-full max-w-sm rounded-md border border-border bg-slate-50 px-3 py-2 text-sm outline-none focus:border-primary"
      />
      {isPending ? (
        <TableSkeleton cols={5} />
      ) : rows.length === 0 ? (
        <EmptyState title="No users match filter" />
      ) : (
        <Table head={["Name", "QSC ID", "Role", "Status", "Created", ""]}>
          {rows.map((u) => (
            <Tr key={u.id}>
              <Td>
                <span className="font-medium">{u.name}</span>
                {u.email && (
                  <span className="block text-xs text-muted">{u.email}</span>
                )}
              </Td>
              <Td className="font-mono text-xs">{u.unique_user_id}</Td>
              <Td>
                <Badge tone={u.role === "ADMIN" ? "warning" : u.role === "ATTACKER" ? "danger" : "info"}>
                  {u.role}
                </Badge>
              </Td>
              <Td>
                <Badge tone={u.is_active === false ? "danger" : "success"}>
                  {u.is_active === false ? "DISABLED" : "ACTIVE"}
                </Badge>
              </Td>
              <Td className="text-xs text-muted">
                {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
              </Td>
              <Td>
                <button
                  onClick={() =>
                    u.is_active === false
                      ? toggle.mutate({ id: u.id, active: true })
                      : setConfirmUser(u)
                  }
                  disabled={toggle.isPending}
                  className={`rounded-md border px-2.5 py-1 text-xs ${
                    u.is_active === false
                      ? "border-success/50 text-success hover:bg-success/10"
                      : "border-danger/50 text-danger hover:bg-danger/10"
                  }`}
                >
                  {u.is_active === false ? "Re-enable" : "Disable"}
                </button>
              </Td>
            </Tr>
          ))}
        </Table>
      )}

      <ConfirmDialog
        open={confirmUser != null}
        danger
        title="Disable account"
        message={`${confirmUser?.name} will no longer be able to sign in. History rows are preserved.`}
        confirmLabel="Disable"
        onCancel={() => setConfirmUser(null)}
        onConfirm={() => {
          if (confirmUser) toggle.mutate({ id: confirmUser.id, active: false });
        }}
      />
    </>
  );
}

/** F30 — audit log browser (read-only) with client-side CSV export. */
export function AdminAuditPage() {
  const { data, isPending, isError, error, refetch } = useAuditLogs();

  function exportCsv() {
    const items = data?.items ?? [];
    const lines = [
      "id,time,user,role,action,description",
      ...items.map((r) =>
        [
          r.id,
          r.created_at,
          r.user_name ?? "",
          r.user_role ?? "",
          r.action,
          `"${r.description.replace(/"/g, '""')}"`,
        ].join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "qsc-audit-logs.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isError)
    return <ErrorPanel message={(error as Error).message} onRetry={() => refetch()} />;
  const rows = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Audit logs"
        subtitle="Complete trail of auditable actions"
        actions={
          <button
            onClick={exportCsv}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary"
          >
            Export CSV
          </button>
        }
      />
      {isPending ? (
        <TableSkeleton cols={5} />
      ) : rows.length === 0 ? (
        <EmptyState title="No matching audit rows" />
      ) : (
        <Table head={["#", "Time", "User", "Action", "Description"]}>
          {rows.map((r) => (
            <Tr key={r.id}>
              <Td className="font-mono text-xs">{r.id}</Td>
              <Td className="text-xs text-muted">{new Date(r.created_at).toLocaleString()}</Td>
              <Td>
                {r.user_name ?? "system"}
                {r.user_role && (
                  <Badge tone={r.user_role === "ADMIN" ? "warning" : r.user_role === "ATTACKER" ? "danger" : "info"} className="ml-2">
                    {r.user_role}
                  </Badge>
                )}
              </Td>
              <Td>
                <span className="font-mono text-[11px] uppercase tracking-wide text-primary">
                  {r.action}
                </span>
              </Td>
              <Td className="text-sm">{r.description}</Td>
            </Tr>
          ))}
        </Table>
      )}
    </>
  );
}

/** F28 — security events viewer. */
export function AdminSecurityPage() {
  const { data, isPending, isError, error, refetch } = useAdminSecurityEvents();
  if (isError)
    return <ErrorPanel message={(error as Error).message} onRetry={() => refetch()} />;
  const rows = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Security events"
        subtitle="Security reports joined with attack outcomes"
      />
      {isPending ? (
        <TableSkeleton cols={7} />
      ) : rows.length === 0 ? (
        <EmptyState title="No security events yet" hint="Events appear as messages complete their pipeline." />
      ) : (
        <Table head={["Session", "Protocol", "QBER", "Threshold", "Key", "Verdict", "When"]}>
          {rows.map((r, i) => (
            <Tr key={`${r.communication_id}-${i}`}>
              <Td className="font-mono text-xs">#{r.communication_id}</Td>
              <Td className="font-mono text-xs">{r.protocol}</Td>
              <Td className="font-mono text-xs">{(r.qber * 100).toFixed(2)}%</Td>
              <Td className="font-mono text-xs">{(r.threshold * 100).toFixed(0)}%</Td>
              <Td>
                <Badge tone={r.key_status === "ACCEPTED" ? "success" : r.key_status === "REJECTED" ? "danger" : "warning"}>
                  {r.key_status}
                </Badge>
              </Td>
              <Td>
                <Badge tone={r.attack_detected || r.verdict === "BLOCKED" ? "danger" : "success"}>
                  {r.attack_detected ? "ATTACK DETECTED" : r.verdict}
                </Badge>
              </Td>
              <Td className="text-xs text-muted">{new Date(r.created_at).toLocaleString()}</Td>
            </Tr>
          ))}
        </Table>
      )}
    </>
  );
}

/** F29 — protocol usage & performance analytics. */
export function AdminProtocolsPage() {
  const { data, isPending, isError, error, refetch } = useProtocolAnalytics();
  const registry = useProtocols();

  if (isError)
    return <ErrorPanel message={(error as Error).message} onRetry={() => refetch()} />;

  return (
    <>
      <PageHeader
        title="Protocol analytics"
        subtitle="Usage and performance per registered protocol"
      />
      {isPending || !data ? (
        <TableSkeleton cols={7} />
      ) : (
        <>
          <Table head={["Protocol", "Supported", "Sessions", "Avg QBER", "Accept rate", "Attacks", "Avg confidence"]}>
            {data.protocols.map((p) => (
              <Tr key={p.name}>
                <Td className="font-mono text-sm font-semibold">{p.name}</Td>
                <Td>
                  <Badge tone={p.supported ? "success" : "neutral"}>
                    {p.supported ? "runnable" : "stub"}
                  </Badge>
                </Td>
                <Td className="tabular-nums">{p.sessions}</Td>
                <Td className="font-mono text-xs">{(p.avg_qber * 100).toFixed(2)}%</Td>
                <Td className="font-mono text-xs">{(p.acceptance_rate * 100).toFixed(0)}%</Td>
                <Td className="tabular-nums">{p.attacks}</Td>
                <Td className="font-mono text-xs">{(p.avg_confidence * 100).toFixed(0)}%</Td>
              </Tr>
            ))}
          </Table>
          <p className="mt-4 text-[11px] text-muted">
            v1 executes BB84 only; other protocols are registered stubs that return 501
            from the backend when invoked.
            {registry.data && ` Registry lists ${registry.data.length} protocols.`}
          </p>
        </>
      )}
    </>
  );
}

/** Attackers management tab content (admin). */
export function AdminAttackersPage() {
  const { data, isPending } = useAdminUsers("");
  const attackers = (data?.items ?? []).filter((u) => u.role === "ATTACKER");
  return (
    <>
      <PageHeader title="Attackers" subtitle="Accounts holding the ATTACKER role" />
      {isPending ? (
        <TableSkeleton cols={4} />
      ) : attackers.length === 0 ? (
        <EmptyState title="No attacker accounts yet" hint="Create them via the admin API (POST /admin/attackers)." />
      ) : (
        <Table head={["Name", "Email", "QSC ID", "Status"]}>
          {attackers.map((u) => (
            <Tr key={u.id}>
              <Td className="font-medium">{u.name}</Td>
              <Td className="text-sm text-muted">{u.email}</Td>
              <Td className="font-mono text-xs">{u.unique_user_id}</Td>
              <Td>
                <Badge tone={u.is_active === false ? "danger" : "success"}>
                  {u.is_active === false ? "DISABLED" : "ACTIVE"}
                </Badge>
              </Td>
            </Tr>
          ))}
        </Table>
      )}
    </>
  );
}

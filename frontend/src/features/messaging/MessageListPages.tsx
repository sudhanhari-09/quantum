import { Link } from "react-router-dom";
import { Card, PageHeader } from "../../components/ui/Card";
import { Table, Td, Tr } from "../../components/ui/Table";
import { StatusPill } from "../../components/ui/StatusPill";
import { EmptyState, ErrorPanel, TableSkeleton } from "../../components/ui/Feedback";
import { useInbox, useSent } from "../../queries/hooks";
import type { MessageRow } from "../../types/api";

function MessageTable({ items }: { items: MessageRow[] }) {
  return (
    <Table head={["From", "Protocol", "QBER", "Key", "Status", "Received", ""]}>
      {items.map((m) => (
        <Tr key={m.id}>
          <Td>
            <span className="font-medium">{m.sender.name}</span>
            {m.status === "DELIVERED" && (
              <span className="ml-2 inline-block h-2 w-2 rounded-full bg-primary" title="Unread" />
            )}
          </Td>
          <Td className="font-mono text-xs">{m.protocol ?? "—"}</Td>
          <Td className="font-mono text-xs">
            {m.qber != null ? `${(m.qber * 100).toFixed(2)}%` : "—"}
          </Td>
          <Td><StatusPill value={m.key_status} /></Td>
          <Td><StatusPill value={m.status} /></Td>
          <Td className="text-xs text-muted">{new Date(m.created_at).toLocaleString()}</Td>
          <Td>
            <Link
              to={`/messages/${m.id}`}
              className="rounded-md border border-border px-2.5 py-1 text-xs hover:border-primary hover:text-primary"
            >
              Open
            </Link>
          </Td>
        </Tr>
      ))}
    </Table>
  );
}

/** F15 — inbox shows only DELIVERED/READ (server-enforced + UI filter). */
export function InboxPage() {
  const { data, isPending, isError, error, refetch } = useInbox();

  if (isError)
    return <ErrorPanel message={error.message} onRetry={() => refetch()} />;

  const rows = (data?.items ?? []).filter((m) =>
    ["DELIVERED", "READ"].includes(m.status),
  );

  return (
    <>
      <PageHeader title="Inbox" subtitle="Messages delivered through the secure path" />
      {isPending ? (
        <TableSkeleton cols={7} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No messages yet"
          hint="Start a secure conversation — compose a message and it will appear here once delivered."
        />
      ) : (
        <MessageTable items={rows} />
      )}
    </>
  );
}

/** F16 — outbox with true terminal states incl. BLOCKED. */
export function SentPage() {
  const { data, isPending, isError, error, refetch } = useSent();

  if (isError)
    return <ErrorPanel message={error.message} onRetry={() => refetch()} />;

  const rows = data?.items ?? [];

  return (
    <>
      <PageHeader title="Sent messages" subtitle="Every attempt with its final result" />
      {isPending ? (
        <TableSkeleton cols={7} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No sent messages yet"
          hint="Compose your first secure message from the Compose page."
        />
      ) : (
        <div className="space-y-3">
          <MessageTable items={rows} />
          {rows.some((m) => m.status === "BLOCKED") && (
            <Card className="border-danger/40 p-4 text-xs text-danger">
              BLOCKED rows were never delivered — open the linked communication or a
              security report for the full verdict.
            </Card>
          )}
        </div>
      )}
    </>
  );
}

import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui/Card";
import { Table, Td, Tr } from "../../components/ui/Table";
import { StatusPill } from "../../components/ui/StatusPill";
import { EmptyState, ErrorPanel, TableSkeleton } from "../../components/ui/Feedback";
import { useCommunications } from "../../queries/hooks";

/** F17 — full communication history (sender or receiver side). */
export function HistoryPage() {
  const { data, isPending, isError, error, refetch } = useCommunications("history");

  if (isError)
    return <ErrorPanel message={error.message} onRetry={() => refetch()} />;
  const rows = data?.items ?? [];

  return (
    <>
      <PageHeader title="Communication history" subtitle="All sessions where you are a participant" />
      {isPending ? (
        <TableSkeleton cols={6} />
      ) : rows.length === 0 ? (
        <EmptyState title="No communications yet" hint="Your secure sessions will be listed here." />
      ) : (
        <Table head={["#", "Counterpart", "Protocol", "QBER", "Outcome", "Created", ""]}>
          {rows.map((c) => {
            const iAmSender = true; // server returns both directions; label shows names
            void iAmSender;
            return (
              <Tr key={c.id}>
                <Td className="font-mono text-xs">#{c.id}</Td>
                <Td>
                  <span className="text-sm">
                    {c.sender.name} → {c.receiver.name}
                  </span>
                </Td>
                <Td className="font-mono text-xs">{c.protocol ?? "—"}</Td>
                <Td className="font-mono text-xs">
                  {c.qber != null ? `${(c.qber * 100).toFixed(2)}%` : "—"}
                </Td>
                <Td><StatusPill value={c.session_status} /></Td>
                <Td className="text-xs text-muted">{new Date(c.created_at).toLocaleString()}</Td>
                <Td>
                  <Link
                    to={`/communications/${c.id}`}
                    className="rounded-md border border-border px-2.5 py-1 text-xs hover:border-primary hover:text-primary"
                  >
                    Open
                  </Link>
                </Td>
              </Tr>
            );
          })}
        </Table>
      )}
    </>
  );
}

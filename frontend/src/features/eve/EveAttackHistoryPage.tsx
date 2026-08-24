import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui/Card";
import { Table, Td, Tr } from "../../components/ui/Table";
import { Badge } from "../../components/ui/StatusPill";
import { EmptyState, ErrorPanel, TableSkeleton } from "../../components/ui/Feedback";
import { useAttackHistory } from "../../queries/hooks";

/** F25 — EVE's own attack history. */
export function EveAttackHistoryPage() {
  const { data, isPending, isError, error, refetch } = useAttackHistory();

  if (isError)
    return <ErrorPanel message={(error as Error).message} onRetry={() => refetch()} />;
  const rows = data?.items ?? [];

  return (
    <>
      <PageHeader title="Attack history" subtitle="Every simulated attack you launched" />
      {isPending ? (
        <TableSkeleton cols={7} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No attacks launched yet"
          hint="Pick an eligible session from the active sessions list."
        />
      ) : (
        <Table head={["#", "Target", "Strength", "QBER before", "QBER after", "Detection", "When", ""]}>
          {rows.map((a) => (
            <Tr key={a.id}>
              <Td className="font-mono text-xs">#{a.id}</Td>
              <Td className="font-mono text-xs">#{a.communication_id}</Td>
              <Td className="font-mono text-xs">{(a.attack_strength * 100).toFixed(0)}%</Td>
              <Td className="font-mono text-xs">{(a.qber_before * 100).toFixed(2)}%</Td>
              <Td className="font-mono text-xs">
                {(a.qber_after * 100).toFixed(2)}%
                {a.qber_after > a.qber_before && (
                  <span className="ml-1 text-danger">↑</span>
                )}
              </Td>
              <Td>
                <Badge tone={a.detection_status === "DETECTED" ? "danger" : "warning"}>
                  {a.detection_status.replace(/_/g, " ")}
                </Badge>
              </Td>
              <Td className="text-xs text-muted">
                {new Date(a.created_at).toLocaleString()}
              </Td>
              <Td>
                <Link
                  to={`/eve/attack/result/${a.id}`}
                  className="rounded-md border border-border px-2.5 py-1 text-xs hover:border-primary hover:text-primary"
                >
                  Result
                </Link>
              </Td>
            </Tr>
          ))}
        </Table>
      )}
    </>
  );
}

import { Link, useParams } from "react-router-dom";
import { Card, PageHeader } from "../../components/ui/Card";
import { StatusPill } from "../../components/ui/StatusPill";
import { ErrorPanel, Skeleton } from "../../components/ui/Feedback";
import { useMessage } from "../../queries/hooks";

/** Message detail — plaintext only for owner + DELIVERED/READ (backend rule). */
export function MessageDetailPage() {
  const { id } = useParams();
  const messageId = id ? Number(id) : undefined;
  const { data: msg, isPending, isError, error, refetch } = useMessage(messageId);

  if (isPending)
    return (
      <>
        <PageHeader title="Message" />
        <Skeleton className="h-64" />
      </>
    );
  if (isError || !msg)
    return (
      <ErrorPanel
        message={error?.message ?? "Message not found"}
        code={(error as unknown as { code?: string })?.code}
        onRetry={() => refetch()}
      />
    );

  const canRead = msg.content != null && msg.content.length > 0;

  return (
    <>
      <PageHeader
        title={`Message #${msg.id}`}
        subtitle={`${msg.sender?.name} → ${msg.receiver?.name}`}
        actions={
          <>
            <Link
              to={`/messages/${msg.id}/security-report`}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary"
            >
              Security report
            </Link>
            {msg.communication_id && (
              <Link
                to={`/communications/${msg.communication_id}`}
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary"
              >
                Live session
              </Link>
            )}
          </>
        }
      />
      <Card className="max-w-2xl p-6">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Status</dt>
            <dd className="mt-1"><StatusPill value={msg.status} /></dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Protocol</dt>
            <dd className="mt-1 font-mono">{msg.protocol ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">QBER</dt>
            <dd className="mt-1 font-mono">
              {msg.qber != null ? `${(msg.qber * 100).toFixed(2)}%` : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Key</dt>
            <dd className="mt-1"><StatusPill value={msg.key_status} /></dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Created</dt>
            <dd className="mt-1">{new Date(msg.created_at).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Read at</dt>
            <dd className="mt-1">
              {msg.read_at ? new Date(msg.read_at).toLocaleString() : "—"}
            </dd>
          </div>
        </dl>

        <hr className="my-5 border-border" />

        {canRead ? (
          <div>
            <p className="mb-2 inline-flex items-center gap-2 rounded-md bg-success/10 px-2.5 py-1 text-xs text-success">
              🔒 Decrypted on the server for you only · never stored in browser storage
            </p>
            <p className="whitespace-pre-wrap rounded-lg border border-border bg-slate-50 p-4 text-sm leading-relaxed">
              {msg.content}
            </p>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
            Content is not available: messages are decryptable only after delivery, and
            only for the sender or receiver.
          </p>
        )}
      </Card>
    </>
  );
}

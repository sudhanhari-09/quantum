import { useState } from "react";
import { Card, PageHeader } from "../../components/ui/Card";
import { useMyProfile } from "../../queries/hooks";
import { ErrorPanel, Skeleton } from "../../components/ui/Feedback";

export function QscIdChip({ qscId }: { qscId: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(qscId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-slate-50 px-3 py-1.5">
      <code className="select-all font-mono text-base font-bold tracking-widest text-primary">
        {qscId}
      </code>
      <button
        onClick={copy}
        aria-label="Copy QSC ID"
        className="text-xs text-muted hover:text-fg"
      >
        {copied ? "copied ✓" : "copy"}
      </button>
    </span>
  );
}

/** F6 — profile page backed by GET /users/me. */
export function ProfilePage() {
  const { data: user, isPending, isError, error, refetch } = useMyProfile();

  if (isError)
    return <ErrorPanel message={error.message} onRetry={() => refetch()} />;
  if (isPending || !user)
    return (
      <>
        <PageHeader title="Profile" />
        <Skeleton className="h-48" />
      </>
    );

  return (
    <>
      <PageHeader title="Profile" subtitle="Your identity on the platform" />
      <Card className="max-w-xl p-6">
        <div className="flex flex-col gap-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Your QSC ID
            </p>
            <div className="mt-1.5">
              <QscIdChip qscId={user.unique_user_id} />
            </div>
            <p className="mt-1.5 text-xs text-muted">
              Share this ID so other users can address secure messages to you.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted">Name</dt>
              <dd className="mt-0.5 font-medium">{user.name}</dd>
            </div>
            <div>
              <dt className="text-muted">Role</dt>
              <dd className="mt-0.5 font-medium">{user.role}</dd>
            </div>
            {user.email && (
              <div className="col-span-2">
                <dt className="text-muted">Email</dt>
                <dd className="mt-0.5 font-medium">{user.email}</dd>
                <p className="mt-1 text-[11px] text-muted">
                  Only visible to you.
                </p>
              </div>
            )}
            {user.created_at && (
              <div className="col-span-2">
                <dt className="text-muted">Member since</dt>
                <dd className="mt-0.5 font-medium">
                  {new Date(user.created_at).toLocaleString()}
                </dd>
              </div>
            )}
          </dl>
        </div>
      </Card>
    </>
  );
}

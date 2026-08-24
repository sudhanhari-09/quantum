import type { ReactNode } from "react";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const toneClass: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-600 border-slate-200",
  info: "bg-primary/10 text-primary border-primary/30",
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning border-warning/30",
  danger: "bg-danger/10 text-danger border-danger/30",
};

export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${toneClass[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Maps an arbitrary API status/state string to a stable badge tone.
 *  Unknown values render a neutral "unmapped" badge, never crash (Sec 09). */
export function StatusPill({ value }: { value: string | null | undefined }) {
  if (!value) return <Badge tone="neutral">—</Badge>;
  const v = value.toUpperCase();
  let tone: Tone = "neutral";
  if (["DELIVERED", "READ", "ACCEPTED", "ENCRYPTED", "KEY_ACCEPTED"].includes(v))
    tone = "success";
  else if (["BLOCKED", "REJECTED", "ATTACK_DETECTED", "KEY_REJECTED", "DETECTED", "FAILED"].includes(v))
    tone = "danger";
  else if (["PROCESSING", "QKD_RUNNING", "AI_ANALYZING", "ENCRYPTING", "SECURITY_CHECK", "PENDING", "NOT_DETECTED" ].includes(v) )
    tone = v === "PENDING" || v === "NOT_DETECTED" ? "warning" : "info";
  const label =
    [
      "DELIVERED",
      "READ",
      "ACCEPTED",
      "ENCRYPTED",
      "BLOCKED",
      "REJECTED",
      "DETECTED",
      "FAILED",
      "PENDING",
      "NOT_DETECTED",
    ].includes(v)
      ? v
      : value.replace(/_/g, " ");
  return <Badge tone={tone}>{label}</Badge>;
}

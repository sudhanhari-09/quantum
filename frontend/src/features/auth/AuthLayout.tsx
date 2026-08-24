import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card } from "../../components/ui/Card";
import { Logo } from "../../components/ui/Logo";

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-blue-50 via-bg to-bg px-4">
      <Card className="w-full max-w-md p-8">
        <div className="flex justify-center">
          <Link to="/" aria-label="Back to home">
            <Logo size="md" subtitle="Quantum Secure Communication" />
          </Link>
        </div>
        <hr className="my-6 border-border" />
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mb-4 mt-0.5 text-xs text-muted">{subtitle}</p>
        {children}
        <div className="mt-5 text-center text-sm text-muted">{footer}</div>
      </Card>
    </div>
  );
}

export interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

export function useFormErrors() {
  const [errors, setErrors] = useState<FieldErrors>({});
  return { errors, setErrors };
}

export function FormErrorBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      {message}
    </div>
  );
}

export function TextField({
  label,
  type = "text",
  value,
  onChange,
  error,
  autoComplete = "off",
  required = true,
  hint,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  autoComplete?: string;
  required?: boolean;
  hint?: ReactNodeLike;
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        aria-invalid={!!error || undefined}
        className={`w-full rounded-md border bg-slate-50 px-3 py-2 text-sm outline-none focus:border-primary ${
          error ? "border-danger" : "border-border"
        }`}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  );
}

type ReactNodeLike = string;

export function PasswordField(props: Omit<Parameters<typeof TextField>[0], "type">) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <TextField {...props} type={show ? "text" : "password"} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-2 top-[34px] text-xs text-muted hover:text-fg"
      >
        {show ? "hide" : "show"}
      </button>
    </div>
  );
}

export function SubmitButton({
  pending,
  children,
}: {
  pending: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="mt-1 w-full rounded-md bg-primary py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
    >
      {pending ? "Please wait…" : children}
    </button>
  );
}

export function SwitchLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="font-medium text-primary hover:underline">
      {children}
    </Link>
  );
}

export function onFormSubmit(handler: () => void) {
  return (e: FormEvent) => {
    e.preventDefault();
    handler();
  };
}

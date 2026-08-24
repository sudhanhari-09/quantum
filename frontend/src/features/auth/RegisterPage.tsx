import { useState } from "react";
import { Link } from "react-router-dom";
import { messageForCode } from "../../core/errors";
import { useAuthStore } from "../../core/authStore";
import { loginUser, registerUser } from "../../queries/auth";
import {
  AuthLayout,
  FormErrorBanner,
  PasswordField,
  SubmitButton,
  SwitchLink,
  TextField,
  onFormSubmit,
} from "./AuthLayout";

export function RegisterPage() {
  const setSession = useAuthStore((s) => s.setSession);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [qscId, setQscId] = useState<string | null>(null);

  function validate(): boolean {
    const fe: Record<string, string> = {};
    if (name.trim().length < 2 || name.trim().length > 80)
      fe.name = "Name must be 2-80 characters.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      fe.email = "Enter a valid email address.";
    if (password.length < 8) fe.password = "Password must be at least 8 characters.";
    if (password !== confirm) fe.confirm = "Passwords do not match.";
    setFieldErrors(fe);
    return Object.keys(fe).length === 0;
  }

  async function submit() {
    setError(undefined);
    if (!validate()) return;
    setPending(true);
    try {
      const user = await registerUser({ name: name.trim(), email: email.trim(), password });
      // auto-login after registration (F3 DONE criteria)
      const res = await loginUser(email.trim(), password);
      setSession(res.user, res.access_token, res.refresh_token);
      setQscId(user.unique_user_id);
    } catch (e) {
      setError(messageForCode((e as { code?: string }).code));
    } finally {
      setPending(false);
    }
  }

  if (qscId) {
    return (
      <AuthLayout
        title="Welcome aboard"
        subtitle="Your unique QSC ID has been generated"
        footer={<SwitchLink to="/dashboard">Go to your dashboard →</SwitchLink>}
      >
        <div
          role="status"
          className="rounded-lg border border-success/40 bg-success/10 p-5 text-center"
        >
          <p className="text-sm text-success">Registration complete</p>
          <p className="mt-3 select-all font-mono text-2xl font-bold tracking-widest text-fg">
            {qscId}
          </p>
          <p className="mt-2 text-xs text-muted">
            Share this ID so others can send you secure messages.
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create account"
      subtitle="Register to receive your unique QSC ID"
      footer={
        <>
          Already registered? <SwitchLink to="/login">Sign in</SwitchLink>
        </>
      }
    >
      <form onSubmit={onFormSubmit(submit)} noValidate>
        <FormErrorBanner message={error} />
        <TextField label="Full name" value={name} onChange={setName} error={fieldErrors.name} autoComplete="name" />
        <TextField label="Email" type="email" value={email} onChange={setEmail} error={fieldErrors.email} autoComplete="email" />
        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
          autoComplete="new-password"
          hint="Minimum 8 characters"
        />
        <PasswordField
          label="Confirm password"
          value={confirm}
          onChange={setConfirm}
          error={fieldErrors.confirm}
          autoComplete="new-password"
        />
        <SubmitButton pending={pending}>Create account</SubmitButton>
        <p className="mt-3 text-center text-xs text-muted">
          Or <Link to="/about-qkd" className="hover:text-fg">learn how simulated QKD works</Link>
        </p>
      </form>
    </AuthLayout>
  );
}

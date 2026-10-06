import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { messageForCode } from "../../core/errors";
import { SESSION_END_MESSAGES, type SessionEndReason } from "../../core/session";
import { ROLE_HOME, type Role } from "../../core/constants/vocab";
import { useAuthStore } from "../../core/authStore";
import { loginUser } from "../../queries/auth";
import {
  AuthLayout,
  FormErrorBanner,
  PasswordField,
  SubmitButton,
  SwitchLink,
  TextField,
  onFormSubmit,
} from "./AuthLayout";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((s) => s.setSession);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  // Explains WHY the user is back on the login page (expired/reused/revoked).
  const endedReason = (location.state as { sessionEnded?: SessionEndReason } | null)
    ?.sessionEnded;

  useEffect(() => {
    if (endedReason) setError(SESSION_END_MESSAGES[endedReason]);
  }, [endedReason]);

  async function submit() {
    setError(undefined);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setPending(true);
    try {
      const res = await loginUser(email.trim(), password);
      setSession(res.user, res.access_token, res.refresh_token);
      navigate(ROLE_HOME[(res.user.role as Role) ?? "USER"], { replace: true });
    } catch (e) {
      setError(messageForCode((e as { code?: string }).code));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Access your secure communication dashboard"
      footer={
        <>
          No account yet? <SwitchLink to="/register">Register</SwitchLink>
        </>
      }
    >
      <form onSubmit={onFormSubmit(submit)} noValidate>
        <FormErrorBanner message={error} />
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
        />
        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <SubmitButton pending={pending}>Sign in</SubmitButton>
      </form>
    </AuthLayout>
  );
}

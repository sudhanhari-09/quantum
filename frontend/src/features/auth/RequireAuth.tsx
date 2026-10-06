import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../../core/authStore";
import { Loader } from "../../components/ui/Feedback";
import type { Role } from "../../core/constants/vocab";

/**
 * Route guard by authentication + allowed roles (F4).
 *
 * Three states, never two:
 *  - `unknown`       → the backend has not confirmed the session yet (boot /
 *                      browser refresh). Render a loader; do NOT redirect and
 *                      do NOT render guarded content.
 *  - `authenticated` → `user`/`role` came from /auth/me; apply the role guard
 *                      exactly as before (fail-closed).
 *  - anything else   → redirect to /login.
 *
 * An undefined role can never silently become USER: without a verified user
 * object the guarded route simply does not render.
 */
export function RequireAuth({
  roles,
  children,
}: {
  roles?: Role[];
  children: ReactNode;
}) {
  const authStatus = useAuthStore((s) => s.authStatus);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (authStatus === "unknown") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <Loader label="Restoring your secure session…" />
      </div>
    );
  }

  if (authStatus !== "authenticated" || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/forbidden" replace />;
  }

  return <>{children}</>;
}

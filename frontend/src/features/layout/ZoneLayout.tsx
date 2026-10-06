import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../../core/authStore";
import { logoutSession } from "../../queries/auth";
import type { Role } from "../../core/constants/vocab";
import { LiveIndicator } from "../../components/ui/FeedbackGlobal";
import { Badge } from "../../components/ui/StatusPill";
import { Logo } from "../../components/ui/Logo";
import {
  IconAtom,
  IconChart,
  IconChevronLeft,
  IconChevronRight,
  IconDashboard,
  IconEye,
  IconHistory,
  IconInbox,
  IconMenu,
  IconPaperPlane,
  IconRadar,
  IconRadio,
  IconScroll,
  IconSend,
  IconShield,
  IconTarget,
  IconUser,
  IconUsers,
} from "../../components/ui/icons";
import type { ComponentType, SVGProps } from "react";

interface NavItem {
  to: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const NAV: Record<Role, NavItem[]> = {
  USER: [
    { to: "/dashboard", label: "Dashboard", Icon: IconDashboard },
    { to: "/messages/compose", label: "Secure Communication", Icon: IconSend },
    { to: "/qkd", label: "QKD Simulation", Icon: IconAtom },
    { to: "/inbox", label: "Inbox", Icon: IconInbox },
    { to: "/sent", label: "Sent", Icon: IconPaperPlane },
    { to: "/history", label: "History", Icon: IconHistory },
    { to: "/security-reports", label: "Security Reports", Icon: IconShield },
    { to: "/profile", label: "Profile", Icon: IconUser },
  ],
  ATTACKER: [
    { to: "/eve/dashboard", label: "Eve Dashboard", Icon: IconEye },
    { to: "/eve/active-sessions", label: "Active Communications", Icon: IconRadar },
    { to: "/eve/active-sessions", label: "Attack Simulation", Icon: IconTarget },
    { to: "/eve/attack/history", label: "Attack History", Icon: IconHistory },
  ],
  ADMIN: [
    { to: "/admin/dashboard", label: "Admin Dashboard", Icon: IconDashboard },
    { to: "/admin/users", label: "Users", Icon: IconUsers },
    { to: "/admin/communications", label: "Communications", Icon: IconRadio },
    { to: "/admin/security", label: "Security Events", Icon: IconShield },
    { to: "/admin/protocols", label: "Protocol Analytics", Icon: IconChart },
    { to: "/admin/attacks", label: "Attack Analytics", Icon: IconTarget },
    { to: "/admin/audit", label: "Audit Logs", Icon: IconScroll },
  ],
};

const COLLAPSE_KEY = "qsc-sidebar-collapsed";

export function ZoneLayout() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === "1",
  );

  useEffect(() => {
    setMenuOpen(false);
    setNavOpen(false);
  }, [location.pathname]);

  if (!user) return null;
  const items = NAV[user.role];

  function logout() {
    // Revokes the refresh token server-side, then clears local state.
    void logoutSession();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      {/* ============ SIDEBAR ============ */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex transform flex-col border-r border-border bg-surface transition-[width,transform] duration-300 lg:static lg:translate-x-0 ${
          collapsed ? "w-[76px]" : "w-60"
        } ${navOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className={`flex h-14 shrink-0 items-center border-b border-border px-4 ${collapsed ? "justify-center px-0" : ""}`}>
          <NavLink to="/" aria-label="QuantumSecure home">
            {collapsed ? (
              <Logo size="sm" />
            ) : (
              <Logo size="sm" subtitle={user.role.toLowerCase()} />
            )}
          </NavLink>
        </div>

        <nav
          className={`flex-1 space-y-1 overflow-y-auto p-3 ${collapsed ? "px-2" : ""}`}
          aria-label="Main navigation"
        >
          {items.map(({ to, label, Icon }, idx) => {
            // dedupe key for repeated targets (EVE attack simulation entry)
            const key = `${to}-${idx}`;
            return (
              <NavLink
                key={key}
                to={to}
                title={collapsed ? label : undefined}
                aria-label={label}
                className={({ isActive }) =>
                  `group relative flex items-center gap-3 rounded-lg py-2 text-sm transition-colors ${
                    collapsed ? "justify-center px-0" : "px-3"
                  } ${
                    isActive
                      ? "bg-primary/10 font-semibold text-primary"
                      : "text-muted hover:bg-slate-100 hover:text-fg"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {/* active rail */}
                    <span
                      aria-hidden="true"
                      className={`absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary transition-all duration-200 ${
                        isActive ? "opacity-100" : "opacity-0 group-hover:opacity-40"
                      }`}
                    />
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="shrink-0 space-y-2 border-t border-border p-3">
          {!collapsed && (
            <div className="px-1 pb-1">
              <LiveIndicator />
            </div>
          )}
          <button
            onClick={() => {
              const next = !collapsed;
              setCollapsed(next);
              localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
            }}
            className="hidden w-full items-center justify-center gap-2 rounded-lg border border-border py-2 text-xs text-muted transition hover:border-primary/40 hover:text-primary lg:flex"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
          >
            {collapsed ? <IconChevronRight className="h-4 w-4" /> : <IconChevronLeft className="h-4 w-4" />}
            {!collapsed && "Collapse"}
          </button>
        </div>
      </aside>

      {navOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/30 backdrop-blur-sm lg:hidden"
          aria-hidden="true"
          onClick={() => setNavOpen(false)}
        />
      )}

      {/* ============ CONTENT COLUMN ============ */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-surface/85 px-4 backdrop-blur lg:px-8">
          <button
            className="rounded-md p-2 hover:bg-slate-100 lg:hidden"
            aria-label="Toggle navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen((v) => !v)}
          >
            <IconMenu className="h-5 w-5" />
          </button>
          <div className="hidden lg:block">
            <Badge tone={user.role === "ADMIN" ? "warning" : user.role === "ATTACKER" ? "danger" : "info"}>
              {user.role} zone
            </Badge>
          </div>
          <div className="relative">
            <button
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition hover:bg-slate-100"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span className="font-medium">{user.name}</span>
              <span aria-hidden="true">▾</span>
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="anim-pop absolute right-0 mt-1 w-48 rounded-lg border border-border bg-surface p-1 shadow-lg"
              >
                {user.role === "USER" && (
                  <button
                    role="menuitem"
                    className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => {
                      setMenuOpen(false);
                      navigate("/profile");
                    }}
                  >
                    Profile
                  </button>
                )}
                <button
                  role="menuitem"
                  className="block w-full rounded px-3 py-2 text-left text-sm text-danger hover:bg-red-50"
                  onClick={logout}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        {/* §22 — keyed route transition */}
        <main className="min-w-0 flex-1 p-4 lg:p-8">
          <div key={location.pathname} className="anim-page">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

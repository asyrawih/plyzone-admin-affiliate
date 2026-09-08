import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, Navigate, useLocation } from "react-router";
import { LayoutDashboard, Users, Receipt, UserRound, Banknote, Settings, ScrollText, LogOut, Route, ShieldAlert } from "lucide-react";
import { MapSelect } from "@/components/MapSelect";
import { get, post } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => get<{ user: { id: number; username: string } | null }>("/api/auth/me"), retry: false });
}

export function RequireOwner({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const loc = useLocation();
  if (me.isLoading) return <div className="p-8 text-sm text-[var(--muted)]">Memuat…</div>;
  if (me.isError || !me.data?.user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return <>{children}</>;
}

const nav = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/dashboard/flow", label: "Alur", icon: Route },
  { to: "/dashboard/admins", label: "Admins", icon: Users },
  { to: "/dashboard/spend", label: "Spend Events", icon: Receipt },
  { to: "/dashboard/spenders", label: "Spenders", icon: UserRound },
  { to: "/dashboard/payouts", label: "Payouts", icon: Banknote },
  { to: "/dashboard/risk", label: "Risiko", icon: ShieldAlert },
  { to: "/dashboard/config", label: "Config", icon: Settings },
  { to: "/dashboard/audit", label: "Audit", icon: ScrollText },
];

export function Layout() {
  const me = useMe();
  const qc = useQueryClient();
  const counts = useQuery({ queryKey: ["spend-counts"], queryFn: () => get<{ counts: Record<string, number> }>("/api/spend-events?limit=1"), refetchInterval: 30_000 });
  const unmatched = counts.data?.counts?.unmatched ?? 0;
  const risk = useQuery({ queryKey: ["risk-counts"], queryFn: () => get<{ counts: { open: number; high: number; review: number } }>("/api/risk/counts"), refetchInterval: 30_000 });
  const riskOpen = (risk.data?.counts?.open ?? 0) + (risk.data?.counts?.review ?? 0);
  return (
    <div className="flex min-h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--grid)] bg-[var(--surface)]">
        <div className="flex items-start justify-between px-4 py-4"><div><div className="text-sm font-bold">KLSM Affiliate</div><div className="text-xs text-[var(--muted)]">owner: {me.data?.user?.username}</div></div><ThemeToggle /></div>
        <MapSelect />
        <nav className="flex-1 px-2">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cn("mb-0.5 flex items-center gap-2 rounded-md px-2.5 py-2 text-sm", isActive ? "bg-[var(--surface-3)] font-medium" : "text-[var(--ink-2)] hover:bg-[var(--surface-2)]")}>
              <n.icon size={16} /><span className="flex-1">{n.label}</span>
              {n.to === "/dashboard/spend" && unmatched > 0 && <span className="rounded-full bg-[var(--warn-bg)] px-1.5 text-[11px] font-semibold text-[var(--warn-fg)]">{unmatched}</span>}
              {n.to === "/dashboard/risk" && riskOpen > 0 && <span className={cn("rounded-full px-1.5 text-[11px] font-semibold", (risk.data?.counts?.high ?? 0) > 0 ? "bg-[var(--bad-bg)] text-[var(--bad-fg)]" : "bg-[var(--warn-bg)] text-[var(--warn-fg)]")}>{riskOpen}</span>}
            </NavLink>
          ))}
        </nav>
        <button className="m-2 flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-[var(--ink-2)] hover:bg-[var(--surface-2)]" onClick={async () => { await post("/api/auth/logout"); qc.clear(); location.href = "/login"; }}>
          <LogOut size={16} /> Keluar
        </button>
      </aside>
      <main className="min-w-0 flex-1 p-6"><Outlet /></main>
    </div>
  );
}

export function PageTitle({ title, sub, action }: { title: string; sub?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div><h1 className="text-xl font-semibold">{title}</h1>{sub && <p className="text-sm text-[var(--muted)]">{sub}</p>}</div>
      {action}
    </div>
  );
}

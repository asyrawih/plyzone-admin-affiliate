import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { get } from "@/lib/api";
import { AdminView } from "@/components/AdminView";
import { Badge } from "@/components/ui";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Brand } from "@/components/Brand";

/** Halaman admin, read-only, diakses lewat token tanpa login. */
export function PublicAdminPage() {
  const { token } = useParams();
  const q = useQuery({ queryKey: ["public", token], queryFn: () => get<any>(`/a/${token}`), retry: false });
  if (q.isLoading) return <div className="p-8 text-sm text-[var(--muted)]">Memuat…</div>;
  if (q.isError || !q.data) return <div className="p-8 text-center text-sm">Link tidak valid atau sudah diganti. Minta link baru ke owner, atau <Link to="/admin/login" className="underline">login sebagai admin</Link>.</div>;
  const { admin } = q.data;
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div><Brand size="sm" /><h1 className="text-2xl font-semibold">{admin.displayName}</h1><div className="text-sm text-[var(--ink-2)]">Kode referral <code className="rounded bg-[var(--surface-3)] px-1">{admin.referralCode}</code> · <Badge value={admin.status} /></div></div>
        <div className="flex items-center gap-2"><ThemeToggle /><Link to="/admin/login" className="text-xs underline">Login admin</Link></div>
      </div>
      <AdminView data={q.data} endpoints={{ events: `/a/${token}/events`, payouts: `/a/${token}/payouts` }} />
    </div>
  );
}

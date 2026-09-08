import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useQueryClient } from "@tanstack/react-query";
import { post } from "@/lib/api";
import { Button, Card, Input, Label } from "@/components/ui";

export function LoginPage() {
  const nav = useNavigate(); const qc = useQueryClient(); const from = (useLocation().state as { from?: string } | null)?.from;
  const [u, setU] = useState(""); const [p, setP] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-1 flex items-center justify-between"><h1 className="text-lg font-semibold">KLSM Affiliate</h1><ThemeToggle /></div>
        <p className="mb-5 text-sm text-[var(--muted)]">Login owner</p>
        <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(""); try { await post("/api/auth/login", { username: u, password: p }); await qc.invalidateQueries({ queryKey: ["me"] }); nav(from && from.startsWith("/dashboard") ? from : "/dashboard"); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } }}>
          <Label>Username</Label><Input value={u} onChange={(e) => setU(e.target.value)} autoFocus className="mb-3" />
          <Label>Password</Label><Input type="password" value={p} onChange={(e) => setP(e.target.value)} className="mb-4" />
          {err && <p className="mb-3 text-sm text-[var(--critical)]">{err}</p>}
          <Button className="w-full" disabled={busy}>{busy ? "Masuk…" : "Masuk"}</Button>
        </form>
        <p className="mt-4 text-center text-xs text-[var(--muted)]">Admin afiliasi? <a href="/admin/login" className="underline">Login</a> atau <a href="/admin/register" className="underline">daftar</a> di portal admin. <Link to="/" className="underline">Ke beranda</Link>.</p>
      </Card>
    </div>
  );
}

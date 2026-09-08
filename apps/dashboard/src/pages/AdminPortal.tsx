import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "react-router";
import { get, post } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { AdminView } from "@/components/AdminView";
import { Badge, Button, Card, CardBody, CardHeader, CopyButton, Input, Label, Modal, Textarea } from "@/components/ui";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Brand, APP_NAME } from "@/components/Brand";

interface Me { admin: { id: number; username: string | null; displayName: string; status: "pending" | "active" | "inactive"; referralCode: string; referralCodePrev: string | null; referralCodeSetAt: string | null; robloxUsername: string | null; robloxUserId: number | null; createdAt: string } | null }

/** Kartu kode referral: dipilih SEKALI lalu terkunci. Kode otomatis lama tetap jadi alias. */
function ReferralCodeCard({ a, onSet }: { a: NonNullable<Me["admin"]>; onSet: () => void }) {
  const [code, setCode] = useState("");
  const set = useMutation({ mutationFn: () => post("/api/admin-portal/referral-code", { code }), onSuccess: onSet });
  const valid = /^[A-Za-z0-9]{4,12}$/.test(code);
  if (a.referralCodeSetAt) {
    return (
      <Card className="mb-4"><CardHeader title="Kode referral kamu" sub="Sudah dipilih dan terkunci, tidak bisa diganti." />
        <CardBody className="flex flex-wrap items-center gap-3 text-sm">
          <code className="rounded bg-[var(--surface-3)] px-2 py-1 text-base font-semibold">{a.referralCode}</code>
          <CopyButton text={a.referralCode} label="Copy kode" />
          {a.referralCodePrev && <span className="text-xs text-[var(--muted)]">Kode lama <code>{a.referralCodePrev}</code> masih berlaku untuk link yang sudah kamu sebar.</span>}
        </CardBody></Card>
    );
  }
  return (
    <Card className="mb-4 border-[var(--warn)]"><CardHeader title="Pilih kode referral kamu" sub="Sekali disimpan, kode ini permanen dan tidak bisa diganti. Pilih yang gampang diingat teman-temanmu." />
      <CardBody>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-56"><Label>Kode (4–12 huruf/angka)</Label><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={`mis. ${a.displayName.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase() || "KODEKU"}`} maxLength={12} /></div>
          <Button disabled={!valid || set.isPending} onClick={() => { if (confirm(`Kunci kode "${code}"? Tidak bisa diganti lagi.`)) set.mutate(); }}>Simpan & kunci</Button>
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">Sementara ini kode otomatis kamu <code>{a.referralCode}</code> tetap bisa dipakai, dan akan tetap berlaku setelah kamu memilih kode baru.</p>
        {set.error && <p className="mt-2 text-sm text-[var(--critical)]">{(set.error as Error).message}</p>}
      </CardBody></Card>
  );
}

/** Feed undangan: siapa yang masuk lewat kode/undangan kamu dan hasilnya. */
function InvitesCard() {
  const q = useQuery({ queryKey: ["admin-invites"], queryFn: () => get<any>("/api/admin-portal/invites?limit=30"), refetchInterval: 30_000 });
  const label = (r: any) => r.outcome === "attributed" ? ["berhasil", "good"] : r.outcome === "already_referred" ? (r.own ? ["sudah undanganmu", "muted"] : ["sudah terikat ke admin lain", "warn"]) : r.outcome === "self_referral" ? ["akun sendiri", "warn"] : r.outcome === "inactive_admin" ? ["akunmu belum aktif", "warn"] : [r.outcome, "muted"];
  const rows = q.data?.rows ?? [];
  return (
    <Card className="mb-4"><CardHeader title="Undangan terbaru" sub="Dari share link maupun undangan Roblox (Invite di dalam game). Yang sudah terikat ke admin lain tidak bisa diambil." />
      {rows.length ? <div className="divide-y divide-[var(--grid)]">{rows.map((r: any) => { const [t, tone] = label(r); return (
        <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
          <div><span className="font-medium">{r.spender_username ?? r.spender_roblox_user_id}</span> <span className="text-xs text-[var(--muted)]">· {r.via === "invite" ? "undangan Roblox" : "link"} · {fmtDate(r.joined_at)}{r.map_name ? ` · ${r.map_name}` : ""}</span></div>
          <span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${tone === "good" ? "border-green-300 text-green-800 dark:text-green-300" : tone === "warn" ? "border-amber-300 text-amber-800 dark:text-amber-300" : "border-[var(--grid)] text-[var(--muted)]"}`}>{t}</span>
        </div>); })}</div>
      : <div className="px-4 py-6 text-center text-sm text-[var(--muted)]">Belum ada yang masuk lewat kode atau undanganmu.</div>}
    </Card>
  );
}

function useAdminMe() {
  return useQuery({ queryKey: ["admin-me"], queryFn: () => get<Me>("/api/admin-auth/me"), retry: false });
}

function Shell({ children, title = APP_NAME }: { children: React.ReactNode; title?: string }) {
  return <div className="flex min-h-full items-center justify-center p-6"><Card className="w-full max-w-md p-6"><div className="mb-1 flex items-center justify-between text-xs text-[var(--muted)]"><Brand size="sm" sub={title === APP_NAME ? undefined : title} /><ThemeToggle /></div>{children}</Card></div>;
}

export function AdminRegisterPage() {
  const nav = useNavigate(); const qc = useQueryClient();
  const [f, setF] = useState({ username: "", password: "", password2: "", displayName: "", robloxUsername: "", notes: "" });
  const reg = useMutation({
    mutationFn: () => post("/api/admin-auth/register", { username: f.username, password: f.password, displayName: f.displayName, robloxUsername: f.robloxUsername || null, notes: f.notes || null }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["admin-me"] }); nav("/admin"); },
  });
  const mismatch = f.password2.length > 0 && f.password !== f.password2;
  return (
    <Shell>
      <h1 className="mb-1 text-lg font-semibold">Daftar jadi admin</h1>
      <p className="mb-4 text-sm text-[var(--muted)]">Setelah daftar, akun menunggu approval owner. Begitu disetujui, share link kamu aktif dan komisi mulai dihitung.</p>
      <form onSubmit={(e) => { e.preventDefault(); if (!mismatch) reg.mutate(); }} className="space-y-3">
        <div><Label>Nama panggilan</Label><Input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} autoFocus required /></div>
        <div><Label>Username login</Label><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required minLength={3} placeholder="huruf, angka, _ ." /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Password (min 8)</Label><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={8} /></div>
          <div><Label>Ulangi password</Label><Input type="password" value={f.password2} onChange={(e) => setF({ ...f, password2: e.target.value })} required className={mismatch ? "border-[var(--critical)]" : ""} /></div>
        </div>
        <div><Label>Username Roblox kamu (opsional)</Label><Input value={f.robloxUsername} onChange={(e) => setF({ ...f, robloxUsername: e.target.value })} /><p className="mt-1 text-xs text-[var(--muted)]">Dipakai untuk mencegah kamu mengundang diri sendiri.</p></div>
        <div><Label>Catatan untuk owner (opsional)</Label><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="mis. Discord / kontak" /></div>
        {mismatch && <p className="text-sm text-[var(--critical)]">Password tidak sama.</p>}
        {reg.error && <p className="text-sm text-[var(--critical)]">{(reg.error as Error).message}</p>}
        <Button className="w-full" disabled={reg.isPending || mismatch}>{reg.isPending ? "Mendaftar…" : "Daftar"}</Button>
      </form>
      <p className="mt-4 text-center text-sm">Sudah punya akun? <Link to="/admin/login" className="underline">Login</Link></p>
    </Shell>
  );
}

export function AdminLoginPage() {
  const nav = useNavigate(); const qc = useQueryClient();
  const [u, setU] = useState(""); const [p, setP] = useState("");
  const login = useMutation({ mutationFn: () => post("/api/admin-auth/login", { username: u, password: p }), onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["admin-me"] }); nav("/admin"); } });
  return (
    <Shell>
      <h1 className="mb-1 text-lg font-semibold">Login admin</h1>
      <p className="mb-4 text-sm text-[var(--muted)]">Lihat komisi, saldo, dan share link kamu.</p>
      <form onSubmit={(e) => { e.preventDefault(); login.mutate(); }} className="space-y-3">
        <div><Label>Username</Label><Input value={u} onChange={(e) => setU(e.target.value)} autoFocus /></div>
        <div><Label>Password</Label><Input type="password" value={p} onChange={(e) => setP(e.target.value)} /></div>
        {login.error && <p className="text-sm text-[var(--critical)]">{(login.error as Error).message}</p>}
        <Button className="w-full" disabled={login.isPending}>{login.isPending ? "Masuk…" : "Masuk"}</Button>
      </form>
      <p className="mt-4 text-center text-sm">Belum punya akun? <Link to="/admin/register" className="underline">Daftar</Link></p>
    </Shell>
  );
}

export function AdminHomePage() {
  const me = useAdminMe(); const qc = useQueryClient();
  const summary = useQuery({ queryKey: ["admin-portal"], queryFn: () => get<any>("/api/admin-portal/summary"), enabled: me.data?.admin?.status === "active", refetchInterval: 60_000 });
  const [pw, setPw] = useState(false); const [pf, setPf] = useState({ cur: "", nw: "" });
  const changePw = useMutation({ mutationFn: () => post("/api/admin-auth/change-password", { currentPassword: pf.cur, newPassword: pf.nw }), onSuccess: () => { setPw(false); setPf({ cur: "", nw: "" }); } });
  const logout = async () => { await post("/api/admin-auth/logout"); qc.clear(); location.href = "/admin/login"; };
  if (me.isLoading) return <div className="p-8 text-sm text-[var(--muted)]">Memuat…</div>;
  if (me.isError || !me.data?.admin) return <Navigate to="/admin/login" replace />;
  const a = me.data.admin;

  if (a.status !== "active") {
    return (
      <Shell>
        <h1 className="mb-1 text-lg font-semibold">Halo, {a.displayName}</h1>
        {a.status === "pending"
          ? <><Badge value="pending" className="mb-3" /><p className="text-sm">Akun kamu <b>menunggu approval owner</b>. Setelah disetujui, halaman ini akan menampilkan share link dan komisi kamu.</p><p className="mt-2 text-xs text-[var(--muted)]">Daftar {fmtDate(a.createdAt)} · kode referral <code>{a.referralCode}</code> (belum aktif)</p></>
          : <><Badge value="inactive" className="mb-3" /><p className="text-sm">Akun kamu nonaktif. Hubungi owner.</p></>}
        <div className="mt-5 flex gap-2"><Button variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["admin-me"] })}>Cek lagi</Button><Button variant="ghost" onClick={logout}>Keluar</Button></div>
      </Shell>
    );
  }
  const d = summary.data;
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div><div className="text-xs text-[var(--muted)]">{APP_NAME} · portal admin</div><h1 className="text-2xl font-semibold">{a.displayName}</h1><div className="text-sm text-[var(--ink-2)]">@{a.username} · kode <code className="rounded bg-[var(--surface-3)] px-1">{a.referralCode}</code> {a.robloxUsername && `· Roblox ${a.robloxUsername}`}</div></div>
        <div className="flex gap-2"><ThemeToggle /><Button size="sm" variant="outline" onClick={() => setPw(true)}>Ganti password</Button><Button size="sm" variant="ghost" onClick={logout}>Keluar</Button></div>
      </div>
      <ReferralCodeCard a={a} onSet={() => { qc.invalidateQueries({ queryKey: ["admin-me"] }); qc.invalidateQueries({ queryKey: ["admin-portal"] }); }} />
      {!a.robloxUserId && <Card className="mb-4 border-[var(--warn)]"><CardBody className="text-sm">Akun Roblox kamu belum tercatat, jadi undangan lewat tombol <b>Invite</b> Roblox belum bisa dihitung. Minta owner mengisi username Roblox kamu di halaman Admins.</CardBody></Card>}
      <InvitesCard />
      {d?.publicUrl && <Card className="mb-4"><CardHeader title="Link publik kamu" sub="Bisa dibuka tanpa login, cocok dibagikan ke teman untuk lihat progres." /><CardBody className="flex items-center gap-2"><code className="block flex-1 truncate rounded bg-[var(--surface-3)] px-2 py-1 text-xs">{d.publicUrl}</code><CopyButton text={d.publicUrl} /></CardBody></Card>}
      {d ? <AdminView data={d} showLedger endpoints={{ events: "/api/admin-portal/events", spenders: "/api/admin-portal/spenders", ledger: "/api/admin-portal/ledger", payouts: "/api/admin-portal/payouts" }} /> : <div className="text-sm text-[var(--muted)]">Memuat…</div>}
      <Modal open={pw} onClose={() => setPw(false)} title="Ganti password">
        <Label>Password sekarang</Label><Input type="password" value={pf.cur} onChange={(e) => setPf({ ...pf, cur: e.target.value })} className="mb-3" />
        <Label>Password baru (min 8)</Label><Input type="password" value={pf.nw} onChange={(e) => setPf({ ...pf, nw: e.target.value })} className="mb-4" />
        {changePw.error && <p className="mb-2 text-sm text-[var(--critical)]">{(changePw.error as Error).message}</p>}
        <Button disabled={pf.nw.length < 8 || !pf.cur || changePw.isPending} onClick={() => changePw.mutate()}>Simpan</Button>
      </Modal>
    </div>
  );
}

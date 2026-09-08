import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { get, post } from "@/lib/api";
import { fmtIdr, fmtNum } from "@/lib/format";
import { PageTitle } from "@/components/Layout";
import { Badge, Button, Card, Empty, Input, Label, Modal, Table, Td, Th, Textarea } from "@/components/ui";

export function AdminsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["admins-summary"], queryFn: () => get<{ admins: any[] }>("/api/analytics/admins") });
  const raw = useQuery({ queryKey: ["admins-list"], queryFn: () => get<{ admins: any[]; counts: Record<string, number> }>("/api/admins") });
  const pending = (raw.data?.admins ?? []).filter((a) => a.status === "pending");
  const byId = new Map((raw.data?.admins ?? []).map((a) => [a.id, a]));
  // Undangan Roblox dicocokkan lewat roblox_user_id; admin aktif tanpa itu tidak bisa mengundang dari game.
  const noRobloxId = (raw.data?.admins ?? []).filter((a) => a.status === "active" && !a.roblox_user_id);
  const refreshAll = () => { qc.invalidateQueries({ queryKey: ["admins-summary"] }); qc.invalidateQueries({ queryKey: ["admins-list"] }); qc.invalidateQueries({ queryKey: ["setup"] }); };
  const approve = useMutation({ mutationFn: (id: number) => post(`/api/admins/${id}/approve`), onSuccess: refreshAll });
  const reject = useMutation({ mutationFn: (id: number) => post(`/api/admins/${id}/reject`), onSuccess: refreshAll });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ displayName: "", robloxUsername: "", robloxUserId: "", notes: "" });
  const create = useMutation({
    mutationFn: () => post<any>("/api/admins", { displayName: f.displayName, robloxUsername: f.robloxUsername || null, robloxUserId: f.robloxUserId ? Number(f.robloxUserId) : null, notes: f.notes || null }),
    onSuccess: (r: any) => { refreshAll(); setOpen(false); setF({ displayName: "", robloxUsername: "", robloxUserId: "", notes: "" }); if (r?.robloxResolved === false) alert(`Admin dibuat, tapi username Roblox "${r.admin.roblox_username}" tidak ditemukan. Cek ejaan di detail admin.`); },
  });
  return (
    <>
      <PageTitle title="Admins" sub="Admin afiliasi yang mengundang spender. Admin bisa daftar sendiri di /admin/register, lalu di-approve di sini." action={<Button onClick={() => setOpen(true)}>+ Admin baru</Button>} />
      {pending.length > 0 && (
        <Card className="mb-4 border-[var(--warn-bd)]">
          <div className="flex items-center justify-between border-b border-[var(--grid)] px-4 py-3"><h3 className="text-sm font-semibold">Menunggu approval ({pending.length})</h3><span className="text-xs text-[var(--muted)]">Kode referral mereka baru aktif setelah di-approve</span></div>
          <Table><thead><tr><Th>Nama</Th><Th>Username</Th><Th>Roblox</Th><Th>Catatan</Th><Th>Daftar</Th><Th></Th></tr></thead>
            <tbody>{pending.map((a) => (
              <tr key={a.id}><Td className="font-medium">{a.display_name}</Td><Td><code className="text-xs">{a.username}</code></Td><Td className="text-xs">{a.roblox_username ?? "-"}{a.roblox_user_id ? <span className="text-[var(--muted)]"> #{a.roblox_user_id}</span> : ""}</Td><Td className="max-w-64 truncate text-xs" title={a.notes ?? ""}>{a.notes ?? "-"}</Td><Td className="text-xs">{new Date(a.created_at).toLocaleString("id-ID")}</Td>
                <Td className="whitespace-nowrap"><Button size="sm" onClick={() => approve.mutate(a.id)}>Approve</Button> <Button size="sm" variant="ghost" onClick={() => confirm("Tolak pendaftaran ini?") && reject.mutate(a.id)}>Tolak</Button></Td></tr>))}</tbody></Table>
        </Card>
      )}
      {noRobloxId.length > 0 && <div className="mb-4 rounded-md border border-[var(--warn-bd)] bg-[var(--warn-bg)] px-4 py-2 text-sm">{noRobloxId.length} admin aktif belum punya <b>Roblox ID</b>: {noRobloxId.map((a) => <Link key={a.id} to={`/dashboard/admins/${a.id}`} className="underline">{a.display_name}</Link>).reduce((acc: any[], el, i) => (i ? [...acc, ", ", el] : [el]), [])}. Undangan lewat tombol Invite Roblox mereka tidak bisa dihitung sampai diisi (buka detail admin → Akun Roblox).</div>}
      <Card>
        <Table><thead><tr><Th>Admin</Th><Th>Login</Th><Th>Roblox</Th><Th>Kode</Th><Th>Status</Th><Th right>Referral</Th><Th right>Spender aktif</Th><Th right>Net spend</Th><Th right>Komisi</Th><Th right>Dibayar</Th><Th right>Saldo</Th></tr></thead>
          <tbody>{(list.data?.admins ?? []).map((a) => (
            <tr key={a.admin_id} className="hover:bg-[var(--surface-2)]">
              <Td><Link to={`/dashboard/admins/${a.admin_id}`} className="font-medium hover:underline">{a.display_name}</Link></Td>
              <Td className="text-xs">{byId.get(a.admin_id)?.username ? <code>{byId.get(a.admin_id).username}</code> : <span className="text-[var(--muted)]">belum ada</span>}</Td>
              <Td className="text-xs whitespace-nowrap">{(() => { const r = byId.get(a.admin_id); return r?.roblox_user_id ? <>{r.roblox_username ?? "?"} <span className="text-[var(--muted)]">#{r.roblox_user_id}</span></> : r?.roblox_username ? <span className="text-amber-700 dark:text-amber-300" title="username ada tapi UserId belum ketemu">{r.roblox_username} · tanpa ID</span> : <span className="text-amber-700 dark:text-amber-300">belum ada</span>; })()}</Td>
              <Td className="text-xs"><code>{a.referral_code}</code>{byId.get(a.admin_id)?.referral_code_set_at ? <span className="ml-1 text-[var(--muted)]" title={`alias lama ${byId.get(a.admin_id)?.referral_code_prev ?? ""}`}>🔒</span> : <span className="ml-1 text-[var(--muted)]" title="kode otomatis, admin belum memilih kodenya">auto</span>}</Td><Td><Badge value={a.status} /></Td>
              <Td right>{fmtNum(a.referrals)}</Td><Td right>{fmtNum(a.spenders_with_spend)}</Td><Td right>{fmtIdr(a.net_idr)}</Td>
              <Td right>{fmtIdr(a.commission_idr)}</Td><Td right>{fmtIdr(a.paid_idr)}</Td><Td right className="font-semibold">{fmtIdr(a.balance_idr)}</Td>
            </tr>))}</tbody></Table>
        {!list.data?.admins?.length && <Empty>Belum ada admin. Buat admin, lalu bagikan share link-nya.</Empty>}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Admin baru">
        <Label>Nama</Label><Input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} className="mb-3" autoFocus />
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div><Label>Username Roblox</Label><Input value={f.robloxUsername} onChange={(e) => setF({ ...f, robloxUsername: e.target.value })} /><p className="mt-1 text-xs text-[var(--muted)]">UserId dicari otomatis dari username ini.</p></div>
          <div><Label>UserId Roblox (isi manual kalau perlu)</Label><Input value={f.robloxUserId} onChange={(e) => setF({ ...f, robloxUserId: e.target.value })} /></div>
        </div>
        <p className="mb-3 text-xs text-[var(--muted)]">Roblox ID dipakai untuk mencocokkan undangan dari tombol Invite Roblox dan memblokir self-referral. Tanpa ini, admin hanya bisa mengundang lewat share link.</p>
        <Label>Catatan</Label><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="mb-4" />
        {create.error && <p className="mb-2 text-sm text-[var(--critical)]">{(create.error as Error).message}</p>}
        <Button onClick={() => create.mutate()} disabled={!f.displayName || create.isPending}>Simpan</Button>
      </Modal>
    </>
  );
}

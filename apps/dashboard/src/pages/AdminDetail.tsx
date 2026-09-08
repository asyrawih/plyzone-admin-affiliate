import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { get, patch, post } from "@/lib/api";
import { fmtDate, fmtIdr, fmtNum } from "@/lib/format";
import { PageTitle } from "@/components/Layout";
import { Pager, usePaged } from "@/components/Pager";
import { MonthlyBars } from "@/components/LazyCharts";
import { Badge, Button, Card, CardBody, CardHeader, CopyButton, Empty, Input, Label, Modal, Stat, Table, Td, Th } from "@/components/ui";

export function AdminDetailPage() {
  const id = Number(useParams().id); const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", id], queryFn: () => get<any>(`/api/admins/${id}`) });
  const [tab, setTab] = useState<"spenders" | "events" | "ledger" | "payouts" | "invites">("events");
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["admin", id] }); qc.invalidateQueries({ queryKey: ["admins-summary"] }); qc.invalidateQueries({ queryKey: ["admins-list"] }); qc.invalidateQueries({ queryKey: ["admin-ledger", id] }); };
  const invites = usePaged<any>(`/api/admins/${id}/invites`, { limit: 25, enabled: tab === "invites", queryKey: ["admin-invites", id] });
  const [rbx, setRbx] = useState<string | null>(null);
  const saveRbx = useMutation({ mutationFn: () => patch<any>(`/api/admins/${id}`, { robloxUsername: rbx ?? "" }), onSuccess: (r) => { setRbx(null); invalidate(); if (r?.robloxResolved === false) alert(`Username "${r.admin.roblox_username}" tidak ditemukan di Roblox. Cek ejaannya.`); } });
  const resolveRbx = useMutation({ mutationFn: () => post<any>(`/api/admins/${id}/resolve-roblox`), onSuccess: invalidate });
  const inviteLabel = (r: any): [string, string] => r.outcome === "attributed" ? ["berhasil", "good"] : r.outcome === "already_referred" ? (r.own ? ["sudah miliknya", "muted"] : ["sudah terikat ke admin lain", "warn"]) : r.outcome === "self_referral" ? ["akun sendiri", "warn"] : r.outcome === "inactive_admin" ? ["admin belum aktif", "warn"] : [r.outcome, "muted"];
  // Tiap tab berhalaman & hanya di-fetch saat aktif.
  const events = usePaged<any>(`/api/spend-events?adminId=${id}`, { limit: 25, enabled: tab === "events", queryKey: ["admin-events", id] });
  const spendersQ = usePaged<any>(`/api/spenders?adminId=${id}`, { limit: 25, enabled: tab === "spenders", queryKey: ["admin-spenders", id] });
  const ledger = usePaged<any>(`/api/admins/${id}/ledger`, { limit: 25, enabled: tab === "ledger", queryKey: ["admin-ledger", id] });
  const payouts = usePaged<any>(`/api/payouts?adminId=${id}`, { limit: 25, enabled: tab === "payouts", queryKey: ["admin-payouts", id] });
  const active = { events, spenders: spendersQ, ledger, payouts, invites }[tab];
  const approve = useMutation({ mutationFn: () => post(`/api/admins/${id}/approve`), onSuccess: invalidate });
  const [loginOpen, setLoginOpen] = useState(false); const [lf, setLf] = useState({ username: "", password: "" });
  const setLogin = useMutation({ mutationFn: () => post(`/api/admins/${id}/set-login`, lf), onSuccess: () => { setLoginOpen(false); setLf({ username: "", password: "" }); invalidate(); } });
  const toggle = useMutation({ mutationFn: () => patch(`/api/admins/${id}`, { status: q.data.admin.status === "active" ? "inactive" : "active" }), onSuccess: invalidate });
  const regen = useMutation({ mutationFn: () => post(`/api/admins/${id}/regenerate-token`), onSuccess: invalidate });
  if (!q.data) return <div className="text-sm text-[var(--muted)]">Memuat…</div>;
  const { admin, summary, monthly, shareLinks, publicUrl, maps } = q.data;
  return (
    <>
      <PageTitle title={admin.display_name} sub={<span>Kode <code>{admin.referral_code}</code> · <Badge value={admin.status} /> {admin.roblox_username && `· Roblox ${admin.roblox_username}`} {admin.username ? <>· login <code>{admin.username}</code></> : "· belum punya login"}</span>}
        action={<div className="flex gap-2">
          {admin.status === "pending" && <Button size="sm" onClick={() => approve.mutate()}>Approve</Button>}
          <Button variant="outline" size="sm" onClick={() => { setLf({ username: admin.username ?? "", password: "" }); setLoginOpen(true); }}>{admin.username ? "Reset password" : "Beri login"}</Button>
          <Button variant="outline" size="sm" onClick={() => toggle.mutate()}>{admin.status === "active" ? "Nonaktifkan" : "Aktifkan"}</Button></div>} />
      {admin.status === "pending" && <div className="mb-4 rounded-md border border-[var(--warn-bd)] bg-[var(--warn-bg)] px-4 py-2 text-sm">Admin ini mendaftar sendiri dan menunggu approval. Kode referralnya belum aktif.{admin.notes && <div className="mt-1 text-xs">Catatan: {admin.notes}</div>}</div>}
      <Modal open={loginOpen} onClose={() => setLoginOpen(false)} title={admin.username ? "Reset password admin" : "Beri login ke admin"}>
        <Label>Username</Label><Input value={lf.username} onChange={(e) => setLf({ ...lf, username: e.target.value })} className="mb-3" />
        <Label>Password baru (min 8)</Label><Input value={lf.password} onChange={(e) => setLf({ ...lf, password: e.target.value })} className="mb-1" />
        <p className="mb-4 text-xs text-[var(--muted)]">Sampaikan ke admin. Session lama admin ini akan dilogout.</p>
        {setLogin.error && <p className="mb-2 text-sm text-[var(--critical)]">{(setLogin.error as Error).message}</p>}
        <Button disabled={lf.username.length < 3 || lf.password.length < 8 || setLogin.isPending} onClick={() => setLogin.mutate()}>Simpan</Button>
      </Modal>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Saldo tersedia" value={fmtIdr(q.data.available_idr)} sub={q.data.held_idr ? `tertahan ${fmtIdr(q.data.held_idr)} (masa tahan)` : undefined} tone={q.data.available_idr > 0 ? "warn" : undefined} />
        <Stat label="Total komisi" value={fmtIdr(summary?.commission_idr)} />
        <Stat label="Sudah dibayar" value={fmtIdr(summary?.paid_idr)} sub={summary?.pending_idr ? `pending ${fmtIdr(summary.pending_idr)}` : undefined} />
        <Stat label="Referral" value={fmtNum(summary?.referrals)} sub={`${fmtNum(summary?.spenders_with_spend)} pernah spend`} />
        <Stat label="Net spend" value={fmtIdr(summary?.net_idr)} />
      </div>
      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Akun Roblox" sub="Dipakai untuk mencocokkan undangan dari tombol Invite Roblox dan memblokir self-referral." />
          <CardBody className="text-sm">
            {rbx === null ? (
              <div className="flex flex-wrap items-center gap-2">
                {admin.roblox_user_id
                  ? <><span className="font-medium">{admin.roblox_username ?? "?"}</span><code className="rounded bg-[var(--surface-3)] px-1.5 py-0.5 text-xs">UserId {admin.roblox_user_id}</code><span className="rounded border border-green-300 px-1.5 py-0.5 text-[11px] text-green-800 dark:text-green-300">siap undang</span></>
                  : admin.roblox_username
                    ? <><span className="font-medium">{admin.roblox_username}</span><span className="rounded border border-amber-300 px-1.5 py-0.5 text-[11px] text-amber-800 dark:text-amber-300">UserId belum ketemu</span><Button size="sm" variant="outline" disabled={resolveRbx.isPending} onClick={() => resolveRbx.mutate()}>Cek ulang</Button></>
                    : <span className="rounded border border-amber-300 px-1.5 py-0.5 text-[11px] text-amber-800 dark:text-amber-300">belum diisi, undangan Roblox admin ini tidak terdeteksi</span>}
                <Button size="sm" variant="ghost" onClick={() => setRbx(admin.roblox_username ?? "")}>Ubah</Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-56"><Label>Username Roblox</Label><Input value={rbx} onChange={(e) => setRbx(e.target.value)} placeholder="kosongkan untuk hapus" autoFocus /></div>
                <Button size="sm" disabled={saveRbx.isPending} onClick={() => saveRbx.mutate()}>Simpan & cari UserId</Button>
                <Button size="sm" variant="ghost" onClick={() => setRbx(null)}>Batal</Button>
              </div>
            )}
            {resolveRbx.error && <p className="mt-2 text-xs text-[var(--critical)]">{(resolveRbx.error as Error).message}</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Kode referral" sub="Admin memilih kodenya sendiri sekali di portal, lalu terkunci." />
          <CardBody className="space-y-1 text-sm">
            <div className="flex flex-wrap items-center gap-2"><code className="rounded bg-[var(--surface-3)] px-2 py-0.5 font-semibold">{admin.referral_code}</code>
              {admin.referral_code_set_at
                ? <span className="text-xs text-[var(--muted)]">dipilih admin, terkunci sejak {fmtDate(admin.referral_code_set_at)}</span>
                : <span className="rounded border border-[var(--grid)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]">kode otomatis, admin belum memilih</span>}</div>
            {admin.referral_code_prev && <div className="text-xs text-[var(--muted)]">Alias lama <code>{admin.referral_code_prev}</code> tetap berlaku untuk link yang sudah tersebar.</div>}
            <div className="text-xs text-[var(--muted)]">LaunchData: <code>ref_{admin.referral_code}</code> · login portal: {admin.username ? <code>{admin.username}</code> : "belum ada"}</div>
          </CardBody>
        </Card>
      </div>
      {(maps?.length ?? 0) > 0 && <Card className="mb-4"><CardHeader title="Penghasilan per map" sub="Sepanjang waktu" />
        <Table><thead><tr><Th>Map</Th><Th right>Transaksi</Th><Th right>Net spend</Th><Th right>Komisi</Th><Th right>Spender</Th><Th right>Referral</Th></tr></thead>
          <tbody>{maps.map((m: any) => <tr key={m.map_id}><Td className="font-medium">{m.map_name}</Td><Td right>{fmtNum(m.events)}</Td><Td right>{fmtIdr(m.net_idr)}</Td><Td right>{fmtIdr(m.commission_idr)}</Td><Td right>{fmtNum(m.spenders)}</Td><Td right>{fmtNum(m.referrals)}</Td></tr>)}</tbody></Table></Card>}
      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2"><CardHeader title="Komisi per bulan" /><CardBody><MonthlyBars data={monthly ?? []} /></CardBody></Card>
        <Card>
          <CardHeader title="Link" />
          <CardBody className="space-y-3 text-sm">
            <div><div className="mb-1 text-xs text-[var(--muted)]">Halaman admin (publik, tanpa login)</div>
              <div className="flex items-center gap-2"><code className="block flex-1 truncate rounded bg-[var(--surface-3)] px-2 py-1 text-xs">{publicUrl}</code><CopyButton text={publicUrl} /></div>
              <Button size="sm" variant="ghost" className="mt-1 text-xs" onClick={() => confirm("Link lama akan mati. Lanjut?") && regen.mutate()}>Regenerate link</Button></div>
            <div><div className="mb-1 text-xs text-[var(--muted)]">Share link Roblox (launchData=ref_{admin.referral_code})</div>
              {shareLinks.length ? shareLinks.map((l: any) => (
                <div key={l.mapId} className="mb-1 flex items-center gap-2"><span className="w-20 shrink-0 text-xs">{l.mapName}</span><code className="block flex-1 truncate rounded bg-[var(--surface-3)] px-2 py-1 text-xs">{l.url}</code><CopyButton text={l.url} /></div>
              )) : <p className="text-xs text-[var(--muted)]">Belum ada map dengan placeId. Tambah di <Link to="/dashboard/config" className="underline">Config</Link>.</p>}</div>
          </CardBody>
        </Card>
      </div>
      <Card>
        <div className="flex gap-1 border-b border-[var(--grid)] px-2 pt-2">
          {(["events", "spenders", "invites", "ledger", "payouts"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded-t px-3 py-2 text-sm ${tab === t ? "border-b-2 border-[var(--ink)] font-medium" : "text-[var(--muted)]"}`}>{{ events: "Spend events", spenders: "Spenders", invites: "Undangan", ledger: "Ledger", payouts: "Payouts" }[t]}</button>)}
        </div>
        {tab === "events" && <Table><thead><tr><Th>Waktu</Th><Th>Sumber</Th><Th>Spender</Th><Th right>Gross</Th><Th right>Net IDR</Th><Th right>Komisi</Th><Th>Status</Th></tr></thead>
          <tbody>{events.rows.map((e: any) => <tr key={e.id}><Td className="text-xs whitespace-nowrap">{fmtDate(e.occurred_at)}</Td><Td><Badge value={e.source} /></Td><Td>{e.spender_username ?? "-"}</Td><Td right>{fmtNum(e.gross_amount)} {e.gross_currency === "ROBUX" ? "R$" : ""}</Td><Td right>{fmtIdr(e.net_idr)}</Td><Td right>{fmtIdr(e.commission_idr)}</Td><Td><Badge value={e.status} /></Td></tr>)}</tbody></Table>}
        {tab === "spenders" && <Table><thead><tr><Th>Spender</Th><Th>UserId</Th><Th>Direferral</Th><Th right>Spend</Th><Th right>Total net</Th><Th>Terakhir</Th></tr></thead>
          <tbody>{spendersQ.rows.map((s: any) => <tr key={s.id}><Td><Link to={`/dashboard/spenders/${s.id}`} className="hover:underline">{s.roblox_username ?? "-"}</Link></Td><Td className="text-xs">{s.roblox_user_id}</Td><Td className="text-xs">{fmtDate(s.referred_at)}</Td><Td right>{fmtNum(s.spend_count)}</Td><Td right>{fmtIdr(s.total_net_idr)}</Td><Td className="text-xs">{fmtDate(s.last_spend_at)}</Td></tr>)}</tbody></Table>}
        {tab === "invites" && <Table><thead><tr><Th>Waktu</Th><Th>Pemain</Th><Th>Jalur</Th><Th>Map</Th><Th>Hasil</Th></tr></thead>
          <tbody>{invites.rows.map((r: any) => { const [t, tone] = inviteLabel(r); return <tr key={r.id}><Td className="text-xs whitespace-nowrap">{fmtDate(r.joined_at)}</Td><Td>{r.spender_id ? <Link to={`/dashboard/spenders/${r.spender_id}`} className="hover:underline">{r.spender_username ?? r.spender_roblox_user_id}</Link> : (r.spender_username ?? r.spender_roblox_user_id)}</Td><Td className="text-xs">{r.via === "invite" ? "undangan Roblox" : `link (${r.code_raw ?? ""})`}</Td><Td className="text-xs">{r.map_name ?? "-"}</Td><Td><span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${tone === "good" ? "border-green-300 text-green-800 dark:text-green-300" : tone === "warn" ? "border-amber-300 text-amber-800 dark:text-amber-300" : "border-[var(--grid)] text-[var(--muted)]"}`}>{t}</span></Td></tr>; })}</tbody></Table>}
        {tab === "ledger" && <Table><thead><tr><Th>Waktu</Th><Th>Tipe</Th><Th right>Nominal</Th><Th>Catatan</Th></tr></thead>
          <tbody>{ledger.rows.map((l: any) => <tr key={l.id}><Td className="text-xs whitespace-nowrap">{fmtDate(l.created_at)}</Td><Td><Badge value={l.type} /></Td><Td right className={l.amount_idr < 0 ? "text-[var(--bad-fg)]" : "text-[var(--good-fg)]"}>{fmtIdr(l.amount_idr)}</Td><Td className="text-xs">{l.note ?? (l.spend_event_id ? `spend #${l.spend_event_id}` : "")}</Td></tr>)}</tbody></Table>}
        {tab === "payouts" && <Table><thead><tr><Th>Dibuat</Th><Th>Jenis</Th><Th right>Nominal</Th><Th>Status</Th><Th>Ref</Th><Th>Dibayar</Th></tr></thead>
          <tbody>{payouts.rows.map((p: any) => <tr key={p.id}><Td className="text-xs whitespace-nowrap">{fmtDate(p.created_at)}</Td><Td>{p.kind}</Td><Td right>{fmtIdr(p.amount_idr)}</Td><Td><Badge value={p.status} /></Td><Td className="text-xs">{p.reference ?? "-"}</Td><Td className="text-xs">{fmtDate(p.paid_at)}</Td></tr>)}</tbody></Table>}
        {!active.rows.length && !active.isLoading && <Empty />}
        <Pager total={active.total} limit={active.limit} page={active.page} onPage={active.setPage} />
      </Card>
    </>
  );
}

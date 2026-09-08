import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { get, post } from "@/lib/api";
import { fmtDate, fmtIdr } from "@/lib/format";
import { PageTitle } from "@/components/Layout";
import { Pager, usePaged } from "@/components/Pager";
import { Badge, Button, Card, CardHeader, Empty, Input, Label, Modal, Select, Table, Td, Th } from "@/components/ui";

const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

export function PayoutsPage() {
  const qc = useQueryClient();
  const list = usePaged<any>("/api/payouts", { limit: 50, urlKey: "page", queryKey: ["payouts"] });
  const adminsQ = useQuery({ queryKey: ["admins-list"], queryFn: () => get<{ admins: any[] }>("/api/admins") });
  const [month, setMonth] = useState(thisMonth()); const [preview, setPreview] = useState<any>(null);
  const [adhoc, setAdhoc] = useState(false); const [f, setF] = useState({ adminId: "", amountIdr: "", method: "", reference: "", note: "" });
  const [paid, setPaid] = useState<any>(null); const [pf, setPf] = useState({ method: "transfer", reference: "", proofUrl: "" });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["payouts"] }); qc.invalidateQueries({ queryKey: ["admins-list"] }); qc.invalidateQueries({ queryKey: ["admins-summary"] }); };
  const doPreview = useMutation({ mutationFn: () => post<any>("/api/payouts/generate-monthly", { month, dryRun: true }), onSuccess: (d) => setPreview(d.preview) });
  const generate = useMutation({ mutationFn: () => post<any>("/api/payouts/generate-monthly", { month }), onSuccess: () => { setPreview(null); refresh(); } });
  const createAdhoc = useMutation({ mutationFn: () => post("/api/payouts", { adminId: Number(f.adminId), amountIdr: Number(f.amountIdr), method: f.method || undefined, reference: f.reference || undefined, note: f.note || undefined }), onSuccess: () => { setAdhoc(false); refresh(); } });
  const markPaid = useMutation({ mutationFn: () => post(`/api/payouts/${paid.id}/paid`, { method: pf.method, reference: pf.reference || undefined, proofUrl: pf.proofUrl || undefined }), onSuccess: () => { setPaid(null); refresh(); } });
  const cancel = useMutation({ mutationFn: (id: number) => post(`/api/payouts/${id}/cancel`), onSuccess: refresh });
  const selAdmin = adminsQ.data?.admins.find((a) => a.id === Number(f.adminId));
  return (
    <>
      <PageTitle title="Payouts" sub="Payout bulanan (batch) atau ad-hoc, dengan approval owner" action={<Button variant="outline" onClick={() => setAdhoc(true)}>+ Payout ad-hoc</Button>} />
      <Card className="mb-4"><CardHeader title="Generate payout bulanan" sub="Membuat payout pending sebesar saldo tiap admin aktif (≥ minimum). Saldo langsung dikurangi." />
        <div className="flex items-end gap-2 p-4"><div><Label>Bulan</Label><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div><Button variant="outline" onClick={() => doPreview.mutate()}>Preview</Button></div>
        {preview && <div className="border-t border-[var(--grid)]">
          <Table><thead><tr><Th>Admin</Th><Th right>Saldo tersedia</Th><Th right>Tertahan</Th><Th>Keterangan</Th></tr></thead><tbody>{preview.rows.map((r: any) => <tr key={r.adminId}><Td>{r.displayName}</Td><Td right>{fmtIdr(r.balance)}</Td><Td right className="text-[var(--muted)]">{r.held ? fmtIdr(r.held) : "-"}</Td><Td className="text-xs">{r.eligible ? <span className="text-[var(--good-fg)]">akan dibuat</span> : r.reason}</Td></tr>)}</tbody></Table>
          <div className="flex items-center justify-between p-3 text-sm"><span>Minimum payout: {fmtIdr(preview.minPayout)} · {preview.rows.filter((r: any) => r.eligible).length} admin eligible</span>
            <Button disabled={!preview.rows.some((r: any) => r.eligible) || generate.isPending} onClick={() => generate.mutate()}>Buat payout</Button></div></div>}
      </Card>
      <Card><CardHeader title="Riwayat payout" />
        <Table><thead><tr><Th>Dibuat</Th><Th>Admin</Th><Th>Jenis</Th><Th>Periode</Th><Th right>Nominal</Th><Th>Status</Th><Th>Metode / Ref</Th><Th></Th></tr></thead>
          <tbody>{list.rows.map((p) => (
            <tr key={p.id}><Td className="text-xs whitespace-nowrap">{fmtDate(p.created_at)}</Td><Td><Link to={`/dashboard/admins/${p.admin_id}`} className="hover:underline">{p.admin_name}</Link></Td><Td>{p.kind}</Td>
              <Td className="text-xs">{p.period_start ? `${p.period_start.slice(0, 10)} → ${p.period_end.slice(0, 10)}` : "-"}</Td><Td right className="font-medium">{fmtIdr(p.amount_idr)}</Td><Td><Badge value={p.status} /></Td>
              <Td className="text-xs">{[p.method, p.reference].filter(Boolean).join(" · ") || "-"}{p.proof_url && <a href={p.proof_url} target="_blank" className="ml-1 underline">bukti</a>}</Td>
              <Td className="whitespace-nowrap">{p.status === "pending" && <><Button size="sm" onClick={() => setPaid(p)}>Tandai dibayar</Button> <Button size="sm" variant="ghost" onClick={() => confirm("Batalkan payout? Saldo dikembalikan.") && cancel.mutate(p.id)}>Batal</Button></>}</Td></tr>))}</tbody></Table>
        {!list.rows.length && !list.isLoading && <Empty />}
        <Pager total={list.total} limit={list.limit} page={list.page} onPage={list.setPage} unit="payout" /></Card>
      <Modal open={adhoc} onClose={() => setAdhoc(false)} title="Payout ad-hoc">
        <Label>Admin</Label><Select className="mb-3 w-full" value={f.adminId} onChange={(e) => setF({ ...f, adminId: e.target.value })}><option value="">pilih…</option>{adminsQ.data?.admins.map((a) => <option key={a.id} value={a.id}>{a.display_name} — saldo {fmtIdr(a.balance_idr)}</option>)}</Select>
        <Label>Nominal (IDR)</Label><div className="mb-3 flex gap-2"><Input type="number" value={f.amountIdr} onChange={(e) => setF({ ...f, amountIdr: e.target.value })} />{selAdmin && <Button variant="outline" onClick={() => setF({ ...f, amountIdr: String(selAdmin.balance_idr) })}>Semua</Button>}</div>
        <div className="mb-3 grid grid-cols-2 gap-3"><div><Label>Metode</Label><Input value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} placeholder="transfer / gopay" /></div><div><Label>Referensi</Label><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div></div>
        {createAdhoc.error && <p className="mb-2 text-sm text-[var(--critical)]">{(createAdhoc.error as Error).message}</p>}
        <Button disabled={!f.adminId || !f.amountIdr || createAdhoc.isPending} onClick={() => createAdhoc.mutate()}>Buat (pending)</Button>
      </Modal>
      <Modal open={!!paid} onClose={() => setPaid(null)} title={`Tandai dibayar: ${paid ? fmtIdr(paid.amount_idr) : ""} → ${paid?.admin_name}`}>
        <div className="mb-3 grid grid-cols-2 gap-3"><div><Label>Metode</Label><Input value={pf.method} onChange={(e) => setPf({ ...pf, method: e.target.value })} /></div><div><Label>Referensi transfer</Label><Input value={pf.reference} onChange={(e) => setPf({ ...pf, reference: e.target.value })} /></div></div>
        <Label>URL bukti (opsional)</Label><Input value={pf.proofUrl} onChange={(e) => setPf({ ...pf, proofUrl: e.target.value })} className="mb-4" />
        <Button onClick={() => markPaid.mutate()} disabled={markPaid.isPending}>Konfirmasi dibayar</Button>
      </Modal>
    </>
  );
}

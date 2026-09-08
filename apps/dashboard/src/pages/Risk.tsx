import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { post } from "@/lib/api";
import { fmtDate, fmtIdr, fmtNum } from "@/lib/format";
import { mapQs, useMapFilter } from "@/lib/mapFilter";
import { PageTitle } from "@/components/Layout";
import { Pager, usePaged } from "@/components/Pager";
import { Badge, Button, Card, Empty, Input, Label, Modal, Select, Table, Td, Th } from "@/components/ui";

const KINDS: Record<string, string> = {
  R1: "Produk / harga tidak cocok katalog", R4: "Donasi belum dikonfirmasi proxy", R6: "Percobaan undang diri sendiri", R7: "Payload ditolak (placeId / key)",
};
const sev = (s: string) => s === "high" ? "bg-[var(--bad-bg)] text-[var(--bad-fg)] border-[var(--bad-bd)]" : s === "medium" ? "bg-[var(--warn-bg)] text-[var(--warn-fg)] border-[var(--warn-bd)]" : "bg-[var(--info-bg)] text-[var(--info-fg)] border-[var(--info-bd)]";

/** Halaman Risiko: flag aturan R1..R7 dan event yang ditahan (review). Setiap aksi masuk audit. */
export function RiskPage() {
  const qc = useQueryClient(); const mapId = useMapFilter();
  const [sp, setSp] = useSearchParams();
  const status = sp.get("status") ?? "open", severity = sp.get("severity") ?? "", kind = sp.get("kind") ?? "";
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); n.delete("page"); setSp(n); };
  const url = `/api/risk?${new URLSearchParams({ ...(status && { status }), ...(severity && { severity }), ...(kind && { kind }) })}${mapQs(mapId)}`;
  const q = usePaged<any>(url, { limit: 50, urlKey: "page", queryKey: ["risk", status, severity, kind, mapId] });
  const counts = (q.data as any)?.counts ?? {};
  const [act, setAct] = useState<{ type: "dismiss" | "confirm" | "approve" | "void"; row: any } | null>(null);
  const [note, setNote] = useState("");
  const done = () => { qc.invalidateQueries({ queryKey: ["risk"] }); qc.invalidateQueries({ queryKey: ["risk-counts"] }); qc.invalidateQueries({ queryKey: ["spend"] }); qc.invalidateQueries({ queryKey: ["spend-counts"] }); setAct(null); setNote(""); };
  const run = useMutation({
    mutationFn: async () => {
      if (!act) return;
      if (act.type === "dismiss" || act.type === "confirm") return post(`/api/risk/${act.row.id}/${act.type}`, { note: note || undefined });
      if (act.type === "approve") return post(`/api/spend-events/${act.row.spend_event_id}/approve`, { note: note || undefined });
      if (act.type === "void") return post(`/api/spend-events/${act.row.spend_event_id}/void`, { reason: note || "ditolak dari halaman Risiko" });
    },
    onSuccess: done,
  });
  return (
    <>
      <PageTitle title="Risiko" sub="Temuan aturan anti-fraud. Event berstatus review tidak menghasilkan komisi sampai disetujui." />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Flag terbuka" value={fmtNum(counts.open)} tone={counts.high ? "bad" : counts.open ? "warn" : undefined} />
        <Tile label="Tingkat tinggi" value={fmtNum(counts.high)} tone={counts.high ? "bad" : undefined} />
        <Tile label="Event review" value={fmtNum(counts.review)} tone={counts.review ? "warn" : undefined} sub={<Link to="/dashboard/spend?status=review" className="underline">lihat di Spend Events</Link>} />
        <Tile label="Sedang / rendah" value={`${fmtNum(counts.medium)} / ${fmtNum(counts.low)}`} />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {[["open", "Terbuka"], ["dismissed", "Diabaikan"], ["confirmed", "Terkonfirmasi"], ["", "Semua"]].map(([v, l]) => (
          <Button key={v} size="sm" variant={status === v ? "default" : "outline"} onClick={() => set("status", v!)}>{l}</Button>))}
        <span className="mx-1 text-[var(--muted)]">|</span>
        <Select value={severity} onChange={(e) => set("severity", e.target.value)}><option value="">Semua tingkat</option><option value="high">Tinggi</option><option value="medium">Sedang</option><option value="low">Rendah</option></Select>
        <Select value={kind} onChange={(e) => set("kind", e.target.value)}><option value="">Semua aturan</option>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{k} · {l}</option>)}</Select>
        <span className="ml-auto text-xs text-[var(--muted)]">{fmtNum(q.total)} flag</span>
      </div>
      <Card>
        <Table><thead><tr><Th>Waktu</Th><Th>Tingkat</Th><Th>Temuan</Th><Th>Map</Th><Th>Admin / spender</Th><Th right>Event</Th><Th></Th></tr></thead>
          <tbody>{q.rows.map((r: any) => (
            <tr key={r.id} className="hover:bg-[var(--surface-2)]">
              <Td className="whitespace-nowrap text-xs">{fmtDate(r.created_at)}</Td>
              <Td><span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none ${sev(r.severity)}`}>{r.severity}</span></Td>
              <Td><div className="text-sm">{r.title}</div><div className="text-xs text-[var(--muted)]">{r.kind} · {KINDS[r.kind] ?? ""}{r.note ? ` · catatan: ${r.note}` : ""}</div></Td>
              <Td className="text-xs">{r.map_name ?? "-"}</Td>
              <Td className="text-xs">{r.admin_id ? <Link to={`/dashboard/admins/${r.admin_id}`} className="hover:underline">{r.admin_name}</Link> : "-"}{r.spender_id && <div><Link to={`/dashboard/spenders/${r.spender_id}`} className="hover:underline">{r.spender_username ?? `#${r.spender_id}`}</Link></div>}</Td>
              <Td right className="text-xs">{r.spend_event_id ? <><div>{fmtNum(r.event_gross)} {r.event_currency === "ROBUX" ? "R$" : "IDR"} · {fmtIdr(r.event_net_idr)}</div><Badge value={r.event_status} /></> : "-"}</Td>
              <Td className="whitespace-nowrap">
                {r.status === "open" && <>
                  {r.event_status === "review" && <><Button size="sm" onClick={() => setAct({ type: "approve", row: r })}>Setujui</Button> <Button size="sm" variant="danger" onClick={() => setAct({ type: "void", row: r })}>Void</Button> </>}
                  <Button size="sm" variant="outline" onClick={() => setAct({ type: "dismiss", row: r })}>Abaikan</Button> <Button size="sm" variant="ghost" onClick={() => setAct({ type: "confirm", row: r })}>Konfirmasi</Button>
                </>}
              </Td>
            </tr>))}</tbody></Table>
        {!q.rows.length && !q.isLoading && <Empty>Tidak ada flag {status === "open" ? "terbuka" : ""}</Empty>}
        <Pager total={q.total} limit={q.limit} page={q.page} onPage={q.setPage} unit="flag" />
      </Card>
      <Modal open={!!act} onClose={() => setAct(null)} title={act?.type === "approve" ? "Setujui event review" : act?.type === "void" ? "Void event" : act?.type === "dismiss" ? "Abaikan flag" : "Konfirmasi flag"}>
        <p className="mb-3 text-sm text-[var(--ink-2)]">{act?.type === "approve" ? "Event menjadi berkomisi (kalau ada admin), ledger dibuat dengan masa tahan, flag ditutup." : act?.type === "void" ? "Event ditandai void permanen, flag jadi terkonfirmasi." : act?.type === "dismiss" ? "Flag ditutup sebagai bukan masalah. Event tidak berubah." : "Flag ditandai sebagai fraud terkonfirmasi. Event tidak berubah; void atau nonaktifkan admin terpisah."}</p>
        <Label>Catatan {act?.type === "void" ? "(alasan)" : "(opsional)"}</Label><Input value={note} onChange={(e) => setNote(e.target.value)} className="mb-4" autoFocus />
        {run.error && <p className="mb-2 text-sm text-[var(--critical)]">{(run.error as Error).message}</p>}
        <Button variant={act?.type === "void" ? "danger" : "default"} disabled={run.isPending || (act?.type === "void" && !note)} onClick={() => run.mutate()}>{act?.type === "approve" ? "Setujui" : act?.type === "void" ? "Void" : act?.type === "dismiss" ? "Abaikan" : "Konfirmasi"}</Button>
      </Modal>
    </>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "bad" | "warn" }) {
  return <Card className="p-4"><div className="text-xs text-[var(--muted)]">{label}</div><div className={`mt-1 text-2xl font-semibold tnum ${tone === "bad" ? "text-[var(--bad-fg)]" : tone === "warn" ? "text-[var(--warn-fg)]" : ""}`}>{value}</div>{sub && <div className="mt-1 text-xs text-[var(--ink-2)]">{sub}</div>}</Card>;
}

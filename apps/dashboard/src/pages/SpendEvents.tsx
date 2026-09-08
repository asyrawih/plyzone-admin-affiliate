import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { get, post } from "@/lib/api";
import { mapQs, useMapFilter } from "@/lib/mapFilter";
import { fmtDate, fmtIdr, fmtNum } from "@/lib/format";
import { PageTitle } from "@/components/Layout";
import { Pager, usePaged } from "@/components/Pager";
import { MapSelect } from "@/components/MapSelect";
import { Badge, Button, Card, Empty, Input, Label, Modal, Select, Table, Td, Th } from "@/components/ui";

export function SpendEventsPage() {
  const [sp, setSp] = useSearchParams(); const qc = useQueryClient();
  const status = sp.get("status") ?? "", source = sp.get("source") ?? "";
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); n.delete("page"); setSp(n); };
  const mapId = useMapFilter();
  const q = usePaged<any>(`/api/spend-events?${new URLSearchParams({ ...(status && { status }), ...(source && { source }) })}${mapQs(mapId)}`, { limit: 50, urlKey: "page", queryKey: ["spend", status, source, mapId] });
  const [matchEv, setMatchEv] = useState<any>(null); const [voidEv, setVoidEv] = useState<any>(null);
  const [search, setSearch] = useState(""); const [reason, setReason] = useState("");
  const cands = useQuery({ queryKey: ["spender-search", search], queryFn: () => get<{ rows: any[] }>(`/api/spenders?q=${encodeURIComponent(search)}&limit=20`), enabled: search.length >= 2 });
  const done = () => { qc.invalidateQueries({ queryKey: ["spend"] }); qc.invalidateQueries({ queryKey: ["spend-counts"] }); setMatchEv(null); setVoidEv(null); setReason(""); setSearch(""); };
  const match = useMutation({ mutationFn: (spenderId: number) => post(`/api/spend-events/${matchEv.id}/match`, { spenderId }), onSuccess: done });
  const doVoid = useMutation({ mutationFn: () => post(`/api/spend-events/${voidEv.id}/void`, { reason }), onSuccess: done });
  const approve = useMutation({ mutationFn: (id: number) => post(`/api/spend-events/${id}/approve`, {}), onSuccess: () => { done(); qc.invalidateQueries({ queryKey: ["risk"] }); qc.invalidateQueries({ queryKey: ["risk-counts"] }); } });
  const counts: Record<string, number> = (q.data as any)?.counts ?? {};
  return (
    <>
      <PageTitle title="Spend Events" sub="Semua transaksi Robux & bagi-bagi" />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {[["", "Semua"], ["attributed", "Attributed"], ["unattributed", "Unattributed"], ["unmatched", "Unmatched"], ["review", "Review"], ["void", "Void"]].map(([v, l]) => (
          <Button key={v} size="sm" variant={status === v ? "default" : "outline"} onClick={() => set("status", v!)}>{l}{v && counts[v!] ? ` (${counts[v!]})` : ""}</Button>))}
        <span className="mx-1 text-[var(--muted)]">|</span>
        <Select value={source} onChange={(e) => set("source", e.target.value)}><option value="">Semua sumber</option><option value="robux">Robux</option><option value="bagibagi">Bagi-bagi</option></Select>
        <MapSelect className="h-9" />
        <span className="ml-auto text-xs text-[var(--muted)]">{fmtNum(q.total)} event</span>
      </div>
      <Card>
        <Table><thead><tr><Th>Waktu</Th><Th>Sumber</Th><Th>Spender / Donatur</Th><Th>Admin</Th><Th>Map</Th><Th right>Gross</Th><Th right>Net IDR</Th><Th right>Komisi</Th><Th>Status</Th><Th></Th></tr></thead>
          <tbody>{q.rows.map((e: any) => (
            <tr key={e.id} className="hover:bg-[var(--surface-2)]">
              <Td className="whitespace-nowrap text-xs">{fmtDate(e.occurred_at)}</Td><Td><Badge value={e.source} /></Td>
              <Td>{e.spender_id ? <Link to={`/dashboard/spenders/${e.spender_id}`} className="hover:underline">{e.spender_username ?? e.spender_roblox_user_id}</Link> : <span>{e.donor_name}</span>}{e.message && <div className="max-w-56 truncate text-xs text-[var(--muted)]" title={e.message}>{e.message}</div>}</Td>
              <Td>{e.admin_id ? <Link to={`/dashboard/admins/${e.admin_id}`} className="hover:underline">{e.admin_name}</Link> : "-"}</Td><Td className="text-xs">{e.map_name ?? "-"}</Td>
              <Td right>{fmtNum(e.gross_amount)} {e.gross_currency === "ROBUX" ? "R$" : ""}</Td><Td right>{fmtIdr(e.net_idr)}</Td><Td right className="font-medium">{fmtIdr(e.commission_idr)}</Td>
              <Td><Badge value={e.status} />{e.void_reason && <div className="text-xs text-[var(--muted)]">{e.void_reason}</div>}{e.review_reason && <div className="max-w-56 text-xs text-[var(--warn-fg)]">{e.review_reason}</div>}</Td>
              <Td className="whitespace-nowrap">{e.status === "review" && <Button size="sm" onClick={() => confirm("Setujui event ini? Komisi dibuat dengan masa tahan.") && approve.mutate(e.id)}>Setujui</Button>} {e.status === "unmatched" && <Button size="sm" variant="outline" onClick={() => setMatchEv(e)}>Match</Button>} {e.status !== "void" && <Button size="sm" variant="ghost" onClick={() => setVoidEv(e)}>Void</Button>}</Td>
            </tr>))}</tbody></Table>
        {!q.rows.length && !q.isLoading && <Empty />}
        <Pager total={q.total} limit={q.limit} page={q.page} onPage={q.setPage} unit="event" />
      </Card>
      <Modal open={!!matchEv} onClose={() => setMatchEv(null)} title={`Match donasi ${matchEv ? fmtIdr(matchEv.net_idr) : ""} dari "${matchEv?.donor_name}"`}>
        <p className="mb-3 text-xs text-[var(--muted)]">Pesan: {matchEv?.message || "-"}. Cari spender yang sudah pernah join game.</p>
        <Label>Username / UserId</Label><Input value={search} onChange={(e) => setSearch(e.target.value)} autoFocus placeholder="min 2 karakter" />
        <div className="mt-2 max-h-64 overflow-y-auto">{(cands.data?.rows ?? []).map((s) => (
          <button key={s.id} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-3)]" onClick={() => match.mutate(s.id)}>
            <span>{s.roblox_username} <span className="text-xs text-[var(--muted)]">#{s.roblox_user_id}</span></span><span className="text-xs">{s.referrer_admin_id ? "punya referrer" : "organik"}</span></button>))}</div>
        {match.error && <p className="mt-2 text-sm text-[var(--critical)]">{(match.error as Error).message}</p>}
      </Modal>
      <Modal open={!!voidEv} onClose={() => setVoidEv(null)} title={`Void event #${voidEv?.id}`}>
        <p className="mb-3 text-sm">Komisi {fmtIdr(voidEv?.commission_idr)} akan dibalik dari saldo admin. Tidak bisa dibatalkan.</p>
        <Label>Alasan</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} className="mb-3" autoFocus />
        <Button variant="danger" disabled={!reason || doVoid.isPending} onClick={() => doVoid.mutate()}>Void</Button>
        {doVoid.error && <p className="mt-2 text-sm text-[var(--critical)]">{(doVoid.error as Error).message}</p>}
      </Modal>
    </>
  );
}

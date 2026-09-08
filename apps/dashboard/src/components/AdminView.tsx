import { fmtDate, fmtIdr, fmtNum } from "@/lib/format";
import { MonthlyBars } from "@/components/LazyCharts";
import { Pager, usePaged } from "@/components/Pager";
import { useState } from "react";
import { Badge, Card, CardBody, CardHeader, CopyButton, Empty, Select, Stat, Table, Td, Th } from "@/components/ui";

export interface AdminViewEndpoints { events: string; payouts: string; spenders?: string; ledger?: string }

/**
 * Tampilan komisi untuk admin. Dipakai di halaman publik /a/:token dan portal /admin.
 * `data` = ringkasan (summary, monthly, shareLinks, saldo); daftar diambil berhalaman dari `endpoints`.
 */
export function AdminView({ data, endpoints, showLedger }: { data: any; endpoints: AdminViewEndpoints; showLedger?: boolean }) {
  const { admin, summary, monthly, shareLinks, balance_idr, available_idr, held_idr, maps } = data;
  const mapList: any[] = maps ?? [];
  const multiMap = mapList.length > 1;
  // Filter map lokal untuk tabel spend & undangan (tidak mengubah ringkasan total di atas).
  const [mapId, setMapId] = useState<number | undefined>(undefined);
  const withMap = (u: string | undefined) => (u && mapId ? `${u}${u.includes("?") ? "&" : "?"}mapId=${mapId}` : u);
  const events = usePaged<any>(withMap(endpoints.events)!, { limit: 25, queryKey: ["av-events", endpoints.events, mapId] });
  const payouts = usePaged<any>(endpoints.payouts, { limit: 25, queryKey: ["av-payouts", endpoints.payouts] });
  const spenders = usePaged<any>(withMap(endpoints.spenders) ?? null, { limit: 25, queryKey: ["av-spenders", endpoints.spenders, mapId] });
  const sel = mapId ? mapList.find((m) => m.map_id === mapId) : undefined;
  const ledger = usePaged<any>(showLedger ? endpoints.ledger ?? null : null, { limit: 25, queryKey: ["av-ledger", endpoints.ledger] });
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Saldo kamu" value={fmtIdr(available_idr ?? balance_idr)} sub={held_idr ? `+ ${fmtIdr(held_idr)} tertahan, cair setelah masa tahan` : "belum dibayar"} tone={(available_idr ?? balance_idr) > 0 ? "good" : undefined} />
        <Stat label="Total komisi" value={fmtIdr(summary?.commission_idr)} />
        <Stat label="Sudah dibayar" value={fmtIdr(summary?.paid_idr)} sub={summary?.pending_idr ? `sedang diproses ${fmtIdr(summary.pending_idr)}` : undefined} />
        <Stat label="Orang yang kamu undang" value={fmtNum(summary?.referrals)} sub={`${fmtNum(summary?.spenders_with_spend)} sudah spend`} />
      </div>
      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2"><CardHeader title="Komisi per bulan" /><CardBody><MonthlyBars data={monthly ?? []} /></CardBody></Card>
        <Card><CardHeader title="Share link kamu" sub={`Kode ${admin.referralCode}. Bagikan ke calon spender.`} /><CardBody className="space-y-2">
          {shareLinks?.length ? shareLinks.map((l: any) => <div key={l.url}><div className="text-xs font-medium">{l.mapName}</div><div className="flex items-center gap-2"><code className="block flex-1 truncate rounded bg-[var(--surface-3)] px-2 py-1 text-xs">{l.url}</code><CopyButton text={l.url} /></div></div>) : <p className="text-xs text-[var(--muted)]">Belum ada link. Owner belum menambah map.</p>}
        </CardBody></Card>
      </div>
      {mapList.length > 0 && <Card className="mb-4"><CardHeader title="Penghasilan per map" sub="Dari mana undangan dan spend kamu datang. Klik baris untuk memfilter tabel di bawah." action={mapId ? <button className="text-xs underline" onClick={() => setMapId(undefined)}>Semua map</button> : undefined} />
        <Table><thead><tr><Th>Map</Th><Th right>Undangan</Th><Th right>Transaksi</Th><Th right>Net spend</Th><Th right>Komisi</Th></tr></thead>
          <tbody>{mapList.map((m: any) => <tr key={m.map_id} className={`cursor-pointer hover:bg-[var(--surface-2)] ${m.map_id === mapId ? "bg-[var(--surface-2)] font-medium" : ""}`} onClick={() => setMapId(m.map_id === mapId ? undefined : m.map_id)}>
            <Td className="font-medium">{m.map_name}</Td><Td right>{fmtNum(m.referrals)}</Td><Td right>{fmtNum(m.events)}</Td><Td right>{fmtIdr(m.net_idr)}</Td><Td right className="font-medium">{fmtIdr(m.commission_idr)}</Td></tr>)}</tbody></Table></Card>}
      {endpoints.spenders && <Card className="mb-4"><CardHeader title="Orang yang kamu undang" sub={`${fmtNum(spenders.total)} spender${sel ? ` · map ${sel.map_name}` : ""}`} />
        <Table><thead><tr><Th>Username</Th><Th>Join</Th><Th right>Transaksi</Th><Th right>Total net</Th><Th>Spend terakhir</Th></tr></thead>
          <tbody>{spenders.rows.map((s: any) => <tr key={s.id}><Td>{s.roblox_username ?? "-"}</Td><Td className="text-xs">{fmtDate(s.referred_at)}</Td><Td right>{fmtNum(s.spend_count)}</Td><Td right>{fmtIdr(s.total_net_idr)}</Td><Td className="text-xs">{fmtDate(s.last_spend_at)}</Td></tr>)}</tbody></Table>
        {!spenders.rows.length && !spenders.isLoading && <Empty>Belum ada yang join lewat link kamu</Empty>}
        <Pager total={spenders.total} limit={spenders.limit} page={spenders.page} onPage={spenders.setPage} unit="spender" /></Card>}
      <Card className="mb-4"><CardHeader title="Spend dari undangan kamu" sub={sel ? `Map ${sel.map_name}` : undefined} action={mapList.length > 1 ? <Select className="h-8 text-xs" value={mapId ?? ""} onChange={(e) => setMapId(e.target.value ? Number(e.target.value) : undefined)}><option value="">Semua map</option>{mapList.map((m: any) => <option key={m.map_id} value={m.map_id}>{m.map_name}</option>)}</Select> : undefined} />
        <Table><thead><tr><Th>Waktu</Th><Th>Sumber</Th>{multiMap && <Th>Map</Th>}<Th>Spender</Th><Th right>Gross</Th><Th right>Net</Th><Th right>Komisi</Th><Th>Status</Th></tr></thead>
          <tbody>{events.rows.map((e: any) => <tr key={e.id}><Td className="text-xs whitespace-nowrap">{fmtDate(e.occurred_at)}</Td><Td><Badge value={e.source} /></Td>{multiMap && <Td className="text-xs">{e.map_name ?? "-"}</Td>}<Td>{e.spender_username ?? "-"}</Td><Td right>{fmtNum(e.gross_amount)} {e.gross_currency === "ROBUX" ? "R$" : ""}</Td><Td right>{fmtIdr(e.net_idr)}</Td><Td right className="font-medium">{fmtIdr(e.commission_idr)}</Td><Td><Badge value={e.status} /></Td></tr>)}</tbody></Table>
        {!events.rows.length && !events.isLoading && <Empty>Belum ada spend dari undangan kamu</Empty>}
        <Pager total={events.total} limit={events.limit} page={events.page} onPage={events.setPage} unit="transaksi" /></Card>
      {showLedger && endpoints.ledger && <Card className="mb-4"><CardHeader title="Mutasi saldo" />
        <Table><thead><tr><Th>Waktu</Th><Th>Tipe</Th><Th right>Nominal</Th><Th>Catatan</Th></tr></thead>
          <tbody>{ledger.rows.map((l: any) => <tr key={l.id}><Td className="text-xs whitespace-nowrap">{fmtDate(l.created_at)}</Td><Td><Badge value={l.type} /></Td><Td right className={l.amount_idr < 0 ? "text-[var(--bad-fg)]" : "text-[var(--good-fg)]"}>{fmtIdr(l.amount_idr)}</Td><Td className="text-xs">{l.note ?? (l.spend_event_id ? `spend #${l.spend_event_id}` : "")}</Td></tr>)}</tbody></Table>
        {!ledger.rows.length && !ledger.isLoading && <Empty />}
        <Pager total={ledger.total} limit={ledger.limit} page={ledger.page} onPage={ledger.setPage} unit="mutasi" /></Card>}
      <Card><CardHeader title="Riwayat pembayaran" />
        <Table><thead><tr><Th>Dibuat</Th><Th>Jenis</Th><Th right>Nominal</Th><Th>Status</Th><Th>Dibayar</Th><Th>Ref</Th></tr></thead>
          <tbody>{payouts.rows.map((p: any) => <tr key={p.id}><Td className="text-xs whitespace-nowrap">{fmtDate(p.created_at)}</Td><Td>{p.kind}</Td><Td right className="font-medium">{fmtIdr(p.amount_idr)}</Td><Td><Badge value={p.status} /></Td><Td className="text-xs">{fmtDate(p.paid_at)}</Td><Td className="text-xs">{[p.method, p.reference].filter(Boolean).join(" · ") || "-"}</Td></tr>)}</tbody></Table>
        {!payouts.rows.length && !payouts.isLoading && <Empty>Belum ada pembayaran</Empty>}
        <Pager total={payouts.total} limit={payouts.limit} page={payouts.page} onPage={payouts.setPage} unit="payout" /></Card>
      <p className="mt-6 text-center text-xs text-[var(--muted)]">Robux dihitung setelah potongan 30% Roblox, dikonversi ke Rupiah sesuai rate yang berlaku saat transaksi.</p>
    </>
  );
}

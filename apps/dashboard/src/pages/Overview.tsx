import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { get, rangeQs } from "@/lib/api";
import { useMapFilter } from "@/lib/mapFilter";
import { fmtIdr, fmtNum, fmtDate } from "@/lib/format";
import { PageTitle } from "@/components/Layout";
import { RangePicker, useRange } from "@/components/RangePicker";
import { SpendLine, SourceBars, type SeriesPoint } from "@/components/LazyCharts";
import { Badge, Card, CardBody, CardHeader, Empty, Select, Stat, Table, Td, Th } from "@/components/ui";

export function OverviewPage() {
  const { range, setRange } = useRange();
  const [gran, setGran] = useState<"day" | "week" | "month">("day");
  const mapId = useMapFilter();
  const ov = useQuery({ queryKey: ["overview", range, mapId], queryFn: () => get<any>(`/api/analytics/overview${rangeQs(range, { mapId })}`) });
  const ts = useQuery({ queryKey: ["timeseries", range, gran, mapId], queryFn: () => get<{ series: SeriesPoint[] }>(`/api/analytics/timeseries${rangeQs(range, { granularity: gran, mapId })}`) });
  const lb = useQuery({ queryKey: ["leaderboard", range, mapId], queryFn: () => get<any>(`/api/analytics/leaderboard${rangeQs(range, { mapId })}`) });
  const fn = useQuery({ queryKey: ["funnel", range, mapId], queryFn: () => get<any>(`/api/analytics/funnel${rangeQs(range, { mapId })}`) });
  const pm = useQuery({ queryKey: ["per-map", range], queryFn: () => get<{ maps: any[] }>(`/api/analytics/maps${rangeQs(range)}`) });
  const o = ov.data?.overview;
  const mapName = mapId ? pm.data?.maps.find((m) => m.map_id === mapId)?.map_name : undefined;
  return (
    <>
      <PageTitle title="Overview" sub={mapName ? <>Ringkasan untuk map <b>{mapName}</b> (waktu Asia/Jakarta)</> : "Ringkasan spend & komisi semua map (waktu Asia/Jakarta)"} />
      <RangePicker range={range} onChange={setRange} right={
        <Select value={gran} onChange={(e) => setGran(e.target.value as any)}><option value="day">Harian</option><option value="week">Mingguan</option><option value="month">Bulanan</option></Select>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Net spend (IDR)" value={fmtIdr(o?.net_idr)} sub={`${fmtNum(o?.events)} transaksi`} />
        <Stat label="Komisi terbentuk" value={fmtIdr(o?.commission_idr)} />
        <Stat label="Saldo belum dibayar" value={fmtIdr(o?.outstanding_balance_idr)} sub={`pending payout ${fmtIdr(o?.pending_payout_idr)}`} tone="warn" />
        <Stat label="Spender aktif" value={fmtNum(o?.active_spenders)} />
        <Stat label="Referral baru" value={fmtNum(o?.new_referrals)} sub={fn.data ? `konversi ${(fn.data.funnel.conversion_rate * 100).toFixed(0)}%` : undefined} />
        <Stat label="Unmatched" value={fmtNum(o?.unmatched_count)} sub={<Link to="/dashboard/spend?status=unmatched" className="underline">{fmtIdr(o?.unmatched_idr)} menunggu</Link>} tone={o?.unmatched_count ? "warn" : undefined} />
      </div>
      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2"><CardHeader title="Net spend vs komisi" /><CardBody><SpendLine data={ts.data?.series ?? []} /></CardBody></Card>
        <Card><CardHeader title="Sumber" sub="Robux (net) vs bagi-bagi" /><CardBody><SourceBars data={ts.data?.series ?? []} /></CardBody></Card>
      </div>
      {(pm.data?.maps.length ?? 0) > 1 && <Card className="mb-4">
        <CardHeader title="Per map" sub="Semua map, di rentang yang dipilih. Event review belum berkomisi." />
        <Table><thead><tr><Th>Map</Th><Th right>Transaksi</Th><Th right>Net spend</Th><Th right>Komisi</Th><Th right>Spender</Th><Th right>Referral</Th><Th right>Review</Th></tr></thead>
          <tbody>{pm.data!.maps.map((m) => <tr key={m.map_id} className={m.map_id === mapId ? "bg-[var(--surface-2)]" : ""}>
            <Td className="font-medium">{m.map_name}{!m.is_active && <span className="ml-1 text-xs text-[var(--muted)]">(nonaktif)</span>}</Td>
            <Td right>{fmtNum(m.events)}</Td><Td right>{fmtIdr(m.net_idr)}</Td><Td right>{fmtIdr(m.commission_idr)}</Td><Td right>{fmtNum(m.spenders)}</Td><Td right>{fmtNum(m.referrals)}</Td>
            <Td right>{m.review ? <Link to="/dashboard/spend?status=review" className="font-medium text-[var(--warn-fg)] underline">{fmtNum(m.review)}</Link> : "0"}</Td></tr>)}</tbody></Table>
      </Card>}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Leaderboard admin" />
          <Table><thead><tr><Th>Admin</Th><Th right>Referral</Th><Th right>Spender</Th><Th right>Net</Th><Th right>Komisi</Th></tr></thead>
            <tbody>{(lb.data?.leaderboard ?? []).slice(0, 10).map((r: any) => (
              <tr key={r.admin_id}><Td><Link to={`/dashboard/admins/${r.admin_id}`} className="font-medium hover:underline">{r.display_name}</Link> <span className="text-xs text-[var(--muted)]">{r.referral_code}</span></Td><Td right>{fmtNum(r.referrals)}</Td><Td right>{fmtNum(r.spenders)}</Td><Td right>{fmtIdr(r.net_idr)}</Td><Td right className="font-medium">{fmtIdr(r.commission_idr)}</Td></tr>
            ))}</tbody></Table>
          {!lb.data?.leaderboard?.length && <Empty />}
        </Card>
        <Card>
          <CardHeader title="Event terbaru" />
          <Table><thead><tr><Th>Waktu</Th><Th>Sumber</Th><Th>Spender</Th><Th>Admin</Th><Th right>Net</Th><Th right>Komisi</Th><Th>Status</Th></tr></thead>
            <tbody>{(ov.data?.recent ?? []).map((e: any) => (
              <tr key={e.id}><Td className="whitespace-nowrap text-xs">{fmtDate(e.occurred_at)}</Td><Td><Badge value={e.source} /></Td><Td>{e.spender_username ?? e.donor_name ?? "-"}</Td><Td>{e.admin_name ?? "-"}</Td><Td right>{fmtIdr(e.net_idr)}</Td><Td right>{fmtIdr(e.commission_idr)}</Td><Td><Badge value={e.status} /></Td></tr>
            ))}</tbody></Table>
          {!ov.data?.recent?.length && <Empty />}
        </Card>
      </div>
    </>
  );
}

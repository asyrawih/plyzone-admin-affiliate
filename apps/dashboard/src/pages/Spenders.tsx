import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { get } from "@/lib/api";
import { mapQs, useMapFilter } from "@/lib/mapFilter";
import { fmtDate, fmtIdr, fmtNum } from "@/lib/format";
import { PageTitle } from "@/components/Layout";
import { Pager, usePaged } from "@/components/Pager";
import { Badge, Card, CardHeader, Empty, Input, Stat, Table, Td, Th } from "@/components/ui";

export function SpendersPage() {
  const [sp, setSp] = useSearchParams();
  const q = sp.get("q") ?? "";
  const setQ = (v: string) => { const n = new URLSearchParams(sp); v ? n.set("q", v) : n.delete("q"); n.delete("page"); setSp(n, { replace: true }); };
  const mapId = useMapFilter();
  const list = usePaged<any>(`/api/spenders?${q.length >= 2 ? `q=${encodeURIComponent(q)}` : ""}${mapQs(mapId)}`, { limit: 50, urlKey: "page", queryKey: ["spenders", q, mapId] });
  return (
    <>
      <PageTitle title="Spenders" sub="Player yang pernah join lewat link atau pernah spend" action={<Input placeholder="cari username / userId" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />} />
      <Card>
        <Table><thead><tr><Th>Username</Th><Th>UserId</Th><Th>Referrer</Th><Th>Direferral</Th><Th right>Spend</Th><Th right>Total net</Th><Th>Spend terakhir</Th></tr></thead>
          <tbody>{list.rows.map((s) => (
            <tr key={s.id} className="hover:bg-[var(--surface-2)]"><Td><Link to={`/dashboard/spenders/${s.id}`} className="font-medium hover:underline">{s.roblox_username ?? "-"}</Link></Td><Td className="text-xs">{s.roblox_user_id}</Td>
              <Td>{s.referrer_admin_id ? <Link to={`/dashboard/admins/${s.referrer_admin_id}`} className="hover:underline">{s.referrer_name ?? `#${s.referrer_admin_id}`}</Link> : <span className="text-xs text-[var(--muted)]">organik</span>}</Td>
              <Td className="text-xs">{fmtDate(s.referred_at)}</Td><Td right>{fmtNum(s.spend_count)}</Td><Td right>{fmtIdr(s.total_net_idr)}</Td><Td className="text-xs">{fmtDate(s.last_spend_at)}</Td></tr>))}</tbody></Table>
        {!list.rows.length && !list.isLoading && <Empty />}
        <Pager total={list.total} limit={list.limit} page={list.page} onPage={list.setPage} unit="spender" />
      </Card>
    </>
  );
}

export function SpenderDetailPage() {
  const id = Number(useParams().id);
  const q = useQuery({ queryKey: ["spender", id], queryFn: () => get<any>(`/api/spenders/${id}`) });
  if (!q.data) return <div className="text-sm text-[var(--muted)]">Memuat…</div>;
  const { spender, referralEvents, spendEvents } = q.data;
  const net = spendEvents.filter((e: any) => e.status !== "void").reduce((a: number, e: any) => a + e.net_idr, 0);
  return (
    <>
      <PageTitle title={spender.roblox_username ?? `#${spender.roblox_user_id}`} sub={<span>UserId {spender.roblox_user_id} · referrer: {spender.referrer_admin_id ? <Link to={`/dashboard/admins/${spender.referrer_admin_id}`} className="underline">admin #{spender.referrer_admin_id}</Link> : "organik"}</span>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total net spend" value={fmtIdr(net)} /><Stat label="Transaksi" value={fmtNum(spendEvents.length)} />
        <Stat label="Pertama terlihat" value={<span className="text-base">{fmtDate(spender.first_seen_at)}</span>} /><Stat label="Direferral" value={<span className="text-base">{fmtDate(spender.referred_at)}</span>} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2"><CardHeader title="Spend events" />
          <Table><thead><tr><Th>Waktu</Th><Th>Sumber</Th><Th right>Gross</Th><Th right>Net IDR</Th><Th right>Komisi</Th><Th>Status</Th></tr></thead>
            <tbody>{spendEvents.map((e: any) => <tr key={e.id}><Td className="text-xs whitespace-nowrap">{fmtDate(e.occurred_at)}</Td><Td><Badge value={e.source} /></Td><Td right>{fmtNum(e.gross_amount)} {e.gross_currency === "ROBUX" ? "R$" : ""}</Td><Td right>{fmtIdr(e.net_idr)}</Td><Td right>{fmtIdr(e.commission_idr)}</Td><Td><Badge value={e.status} /></Td></tr>)}</tbody></Table>
          {!spendEvents.length && <Empty />}</Card>
        <Card><CardHeader title="Riwayat join dengan kode" />
          <Table><thead><tr><Th>Waktu</Th><Th>Kode</Th><Th>Hasil</Th></tr></thead>
            <tbody>{referralEvents.map((r: any) => <tr key={r.id}><Td className="text-xs whitespace-nowrap">{fmtDate(r.joined_at)}</Td><Td className="text-xs"><code>{r.referral_code_raw}</code></Td><Td><Badge value={r.outcome} /></Td></tr>)}</tbody></Table>
          {!referralEvents.length && <Empty>Belum pernah join dengan kode</Empty>}</Card>
      </div>
    </>
  );
}

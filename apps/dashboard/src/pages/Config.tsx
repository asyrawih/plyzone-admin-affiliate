import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, get, patch, post } from "@/lib/api";
import { fmtBps, fmtDate, fmtIdr, fmtNum } from "@/lib/format";
import { PageTitle } from "@/components/Layout";
import { Badge, Button, Card, CardBody, CardHeader, CopyButton, Empty, Input, Label, Modal, Table, Td, Th } from "@/components/ui";

export function ConfigPage() {
  const qc = useQueryClient();
  const ratesQ = useQuery({ queryKey: ["rates"], queryFn: () => get<any>("/api/config/rates") });
  const mapsQ = useQuery({ queryKey: ["maps"], queryFn: () => get<{ maps: any[] }>("/api/config/maps") });
  const cur = ratesQ.data?.current;
  const [rf, setRf] = useState({ commission: "", fee: "30", idr: "", min: "0", from: "", hold: "72", confirm: "0" });
  const [prodMap, setProdMap] = useState<any>(null);
  const [mf, setMf] = useState({ name: "", placeId: "", universeId: "" }); const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null);
  const addRate = useMutation({ mutationFn: () => post("/api/config/rates", { commissionBps: Math.round(Number(rf.commission) * 100), robloxFeeBps: Math.round(Number(rf.fee) * 100), idrPerRobux: Number(rf.idr), minPayoutIdr: Number(rf.min), holdHours: Number(rf.hold), bagibagiConfirmHours: Number(rf.confirm), effectiveFrom: rf.from ? new Date(rf.from).toISOString() : undefined }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["rates"] }); setRf({ commission: "", fee: "30", idr: "", min: "0", from: "", hold: "72", confirm: "0" }); } });
  const addMap = useMutation({ mutationFn: () => post<any>("/api/config/maps", { name: mf.name, placeId: mf.placeId ? Number(mf.placeId) : null, universeId: mf.universeId ? Number(mf.universeId) : null }), onSuccess: (d) => { qc.invalidateQueries({ queryKey: ["maps"] }); setNewKey({ name: d.map.name, key: d.ingestKey }); setMf({ name: "", placeId: "", universeId: "" }); } });
  const rotate = useMutation({ mutationFn: (m: any) => post<any>(`/api/config/maps/${m.id}/rotate-key`).then((d) => ({ ...d, name: m.name })), onSuccess: (d) => setNewKey({ name: d.name, key: d.ingestKey }) });
  const toggleMap = useMutation({ mutationFn: (m: any) => patch(`/api/config/maps/${m.id}`, { isActive: !m.is_active }), onSuccess: () => qc.invalidateQueries({ queryKey: ["maps"] }) });
  return (
    <>
      <PageTitle title="Config" sub="Rate komisi (global, dengan history) dan map/game yang mengirim event" />
      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <Card><CardHeader title="Rate saat ini" sub="Perubahan berlaku ke depan. Event lama tetap memakai rate saat terjadi." />
          <CardBody>
            {cur ? <div className="mb-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <div><div className="text-xs text-[var(--muted)]">Komisi admin</div><div className="text-lg font-semibold">{fmtBps(cur.commission_bps)}</div></div>
              <div><div className="text-xs text-[var(--muted)]">Fee Roblox</div><div className="text-lg font-semibold">{fmtBps(cur.roblox_fee_bps)}</div></div>
              <div><div className="text-xs text-[var(--muted)]">IDR / Robux</div><div className="text-lg font-semibold">{fmtNum(cur.idr_per_robux)}</div></div>
              <div><div className="text-xs text-[var(--muted)]">Min. payout</div><div className="text-lg font-semibold">{fmtIdr(cur.min_payout_idr)}</div></div>
              <div><div className="text-xs text-[var(--muted)]">Masa tahan</div><div className="text-lg font-semibold">{fmtNum(cur.hold_hours)} jam</div></div>
              <div><div className="text-xs text-[var(--muted)]">Konfirmasi bagi-bagi</div><div className="text-lg font-semibold">{cur.bagibagi_confirm_hours ? `${fmtNum(cur.bagibagi_confirm_hours)} jam` : "mati"}</div></div>
            </div> : <p className="mb-4 text-sm text-[var(--critical)]">Belum ada rate. Ingest akan ditolak (503) sampai rate dibuat.</p>}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <div><Label>Komisi %</Label><Input type="number" step="0.01" value={rf.commission} onChange={(e) => setRf({ ...rf, commission: e.target.value })} placeholder="10" /></div>
              <div><Label>Fee Roblox %</Label><Input type="number" step="0.01" value={rf.fee} onChange={(e) => setRf({ ...rf, fee: e.target.value })} /></div>
              <div><Label>IDR / Robux</Label><Input type="number" value={rf.idr} onChange={(e) => setRf({ ...rf, idr: e.target.value })} placeholder="145" /></div>
              <div><Label>Min payout</Label><Input type="number" value={rf.min} onChange={(e) => setRf({ ...rf, min: e.target.value })} /></div>
              <div><Label>Berlaku dari</Label><Input type="datetime-local" value={rf.from} onChange={(e) => setRf({ ...rf, from: e.target.value })} /></div>
              <div><Label>Masa tahan (jam)</Label><Input type="number" value={rf.hold} onChange={(e) => setRf({ ...rf, hold: e.target.value })} /></div>
              <div><Label>Konfirmasi bagi-bagi (jam)</Label><Input type="number" value={rf.confirm} onChange={(e) => setRf({ ...rf, confirm: e.target.value })} placeholder="0 = mati" /></div>
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">Kosongkan "berlaku dari" = sekarang. Masa tahan: komisi baru bisa dibayar setelah sekian jam. Konfirmasi bagi-bagi &gt; 0: laporan donasi dari game ditahan (review) sampai webhook proxy yang cocok datang; nyalakan hanya kalau proxy bagi-bagi sudah mengirim webhook ke server ini.</p>
            {addRate.error && <p className="mt-2 text-sm text-[var(--critical)]">{(addRate.error as Error).message}</p>}
            <Button className="mt-3" disabled={!rf.commission || !rf.idr || addRate.isPending} onClick={() => addRate.mutate()}>Simpan rate baru</Button>
          </CardBody>
          <Table><thead><tr><Th>Berlaku dari</Th><Th right>Komisi</Th><Th right>Fee</Th><Th right>IDR/R$</Th><Th right>Min payout</Th><Th right>Tahan</Th></tr></thead>
            <tbody>{(ratesQ.data?.history ?? []).map((r: any) => <tr key={r.id} className={r.id === cur?.id ? "bg-[var(--good-bg)]" : ""}><Td className="text-xs">{fmtDate(r.effective_from)}</Td><Td right>{fmtBps(r.commission_bps)}</Td><Td right>{fmtBps(r.roblox_fee_bps)}</Td><Td right>{fmtNum(r.idr_per_robux)}</Td><Td right>{fmtIdr(r.min_payout_idr)}</Td><Td right className="text-xs">{fmtNum(r.hold_hours)} j</Td></tr>)}</tbody></Table>
        </Card>
        <Card><CardHeader title="Maps / games" sub="Setiap map punya ingest key untuk header x-map-key dari game server. Katalog produk dipakai untuk memverifikasi harga event Robux (aturan R1)." />
          <CardBody>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Nama</Label><Input value={mf.name} onChange={(e) => setMf({ ...mf, name: e.target.value })} /></div>
              <div><Label>Place ID (untuk share link)</Label><Input value={mf.placeId} onChange={(e) => setMf({ ...mf, placeId: e.target.value })} /></div>
              <div><Label>Universe ID</Label><Input value={mf.universeId} onChange={(e) => setMf({ ...mf, universeId: e.target.value })} /></div>
            </div>
            <Button className="mt-3" disabled={!mf.name || addMap.isPending} onClick={() => addMap.mutate()}>Tambah map</Button>
          </CardBody>
          <Table><thead><tr><Th>Nama</Th><Th>Place</Th><Th>Kesehatan</Th><Th right>24 jam</Th><Th right>Produk</Th><Th>Status</Th><Th></Th></tr></thead>
            <tbody>{(mapsQ.data?.maps ?? []).map((m) => <tr key={m.id}><Td className="font-medium">{m.name} <span className="text-xs text-[var(--muted)]">#{m.id}</span></Td><Td className="text-xs">{m.place_id ?? "-"}</Td>
              <Td className="text-xs">{m.stale ? <span className="rounded border border-[var(--warn-bd)] bg-[var(--warn-bg)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--warn-fg)]">tidak ada join &gt; 24 jam</span> : <span className="text-[var(--good-fg)]">ok</span>}<div className="text-[var(--muted)]">join {fmtDate(m.last_join_at)} · spend {fmtDate(m.last_spend_at)}</div></Td>
              <Td right className="text-xs">{fmtNum(m.events_24h)} event{m.review_count ? <div className="text-[var(--warn-fg)]">{fmtNum(m.review_count)} review</div> : null}</Td>
              <Td right className="text-xs">{m.products_count ? fmtNum(m.products_count) : <span className="text-[var(--warn-fg)]" title="Tanpa katalog, harga event Robux tidak diverifikasi">belum ada</span>}</Td>
              <Td><Badge value={m.is_active ? "active" : "inactive"} /></Td>
              <Td className="whitespace-nowrap"><Button size="sm" variant="outline" onClick={() => setProdMap(m)}>Produk</Button> <Button size="sm" variant="outline" onClick={() => confirm("Key lama mati. Lanjut?") && rotate.mutate(m)}>Rotate key</Button> <Button size="sm" variant="ghost" onClick={() => toggleMap.mutate(m)}>{m.is_active ? "Nonaktifkan" : "Aktifkan"}</Button></Td></tr>)}</tbody></Table>
          {!mapsQ.data?.maps?.length && <Empty>Belum ada map</Empty>}
        </Card>
      </div>
      {prodMap && <ProductsModal map={prodMap} onClose={() => { setProdMap(null); qc.invalidateQueries({ queryKey: ["maps"] }); }} />}
      <Modal open={!!newKey} onClose={() => setNewKey(null)} title={`Ingest key untuk ${newKey?.name}`}>
        <p className="mb-2 text-sm">Simpan sekarang. Key ini tidak bisa dilihat lagi.</p>
        <div className="flex items-center gap-2"><code className="block flex-1 break-all rounded bg-[var(--surface-3)] px-2 py-1 text-xs">{newKey?.key}</code><CopyButton text={newKey?.key ?? ""} /></div>
        <p className="mt-3 text-xs text-[var(--muted)]">Di game: header <code>x-map-key</code> pada POST /ingest/join dan /ingest/robux. Lihat folder <code>roblox/</code>.</p>
      </Modal>
    </>
  );
}

/** Katalog produk satu map. Harga yang dikunci tidak ditimpa sinkron dari game (POST /ingest/products). */
function ProductsModal({ map, onClose }: { map: any; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["map-products", map.id], queryFn: () => get<{ products: any[] }>(`/api/config/maps/${map.id}/products`) });
  const [draft, setDraft] = useState({ productId: "", name: "", priceRobux: "" });
  const refresh = () => qc.invalidateQueries({ queryKey: ["map-products", map.id] });
  const save = useMutation({ mutationFn: (items: any[]) => api(`/api/config/maps/${map.id}/products`, { method: "PUT", json: { products: items } }), onSuccess: () => { refresh(); setDraft({ productId: "", name: "", priceRobux: "" }); } });
  const del = useMutation({ mutationFn: (productId: number) => api(`/api/config/maps/${map.id}/products/${productId}`, { method: "DELETE" }), onSuccess: refresh });
  const rows = q.data?.products ?? [];
  const upd = (p: any, v: Partial<{ priceRobux: number; locked: boolean; isActive: boolean; name: string }>) =>
    save.mutate([{ productId: p.product_id, name: v.name ?? p.name, priceRobux: v.priceRobux ?? p.price_robux, locked: v.locked ?? !!p.locked, isActive: v.isActive ?? !!p.is_active }]);
  return (
    <Modal open onClose={onClose} title={`Katalog produk · ${map.name}`}>
      <p className="mb-3 text-xs text-[var(--muted)]">Event Robux hanya berkomisi kalau productId ada di sini dan harganya sama. Kalau katalog kosong, harga tidak diverifikasi. Game bisa mengirim katalognya sendiri lewat <code>POST /ingest/products</code>; baris yang dikunci tidak ditimpa.</p>
      <Table><thead><tr><Th>Product ID</Th><Th>Nama</Th><Th right>Harga R$</Th><Th>Kunci</Th><Th>Aktif</Th><Th>Sumber</Th><Th></Th></tr></thead>
        <tbody>{rows.map((p) => <tr key={p.id}>
          <Td className="text-xs"><code>{p.product_id}</code></Td><Td className="text-xs">{p.name ?? "-"}</Td>
          <Td right><Input className="h-7 w-24 text-right text-xs" defaultValue={p.price_robux} onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 0 && n !== p.price_robux) upd(p, { priceRobux: n, locked: true }); }} /></Td>
          <Td><input type="checkbox" checked={!!p.locked} onChange={(e) => upd(p, { locked: e.target.checked })} /></Td>
          <Td><input type="checkbox" checked={!!p.is_active} onChange={(e) => upd(p, { isActive: e.target.checked })} /></Td>
          <Td className="text-xs text-[var(--muted)]">{p.source}</Td>
          <Td><Button size="sm" variant="ghost" onClick={() => confirm("Hapus produk dari katalog?") && del.mutate(p.product_id)}>Hapus</Button></Td></tr>)}</tbody></Table>
      {!rows.length && !q.isLoading && <Empty>Belum ada produk. Tambah di bawah, atau biarkan game mengirimnya.</Empty>}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div><Label>Product ID</Label><Input value={draft.productId} onChange={(e) => setDraft({ ...draft, productId: e.target.value.replace(/[^0-9]/g, "") })} /></div>
        <div><Label>Nama</Label><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
        <div><Label>Harga R$</Label><Input value={draft.priceRobux} onChange={(e) => setDraft({ ...draft, priceRobux: e.target.value.replace(/[^0-9]/g, "") })} /></div>
      </div>
      {save.error && <p className="mt-2 text-sm text-[var(--critical)]">{(save.error as Error).message}</p>}
      <Button className="mt-3" disabled={!draft.productId || !draft.priceRobux || save.isPending} onClick={() => save.mutate([{ productId: Number(draft.productId), name: draft.name || null, priceRobux: Number(draft.priceRobux), locked: true }])}>Tambah / perbarui (dikunci)</Button>
    </Modal>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Check, Circle, ArrowRight, ArrowDown } from "lucide-react";
import { get } from "@/lib/api";
import { fmtBps, fmtDate, fmtNum } from "@/lib/format";
import { PageTitle } from "@/components/Layout";
import { Card, CardBody, CardHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

/* ---------- diagram ---------- */

function Node({ title, sub, tone = "default", className }: { title: string; sub?: string; tone?: "default" | "owner" | "game" | "system" | "admin"; className?: string }) {
  const tones = {
    default: "border-[var(--axis)] bg-[var(--surface)]",
    owner: "border-[var(--s2)] bg-[var(--warn-bg)]",
    game: "border-[var(--s1)] bg-[var(--info-bg)]",
    system: "border-[var(--axis)] bg-[var(--surface-2)]",
    admin: "border-[var(--s3)] bg-[var(--teal-bg)]",
  };
  return (
    <div className={cn("min-w-36 rounded-md border-2 px-3 py-2 text-center", tones[tone], className)}>
      <div className="text-sm font-semibold leading-tight">{title}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-tight text-[var(--ink-2)]">{sub}</div>}
    </div>
  );
}
const Arrow = ({ label, down }: { label?: string; down?: boolean }) => (
  <div className={cn("flex items-center justify-center text-[var(--muted)]", down ? "flex-col py-1" : "flex-col px-1")}>
    {label && <span className="mb-0.5 max-w-28 text-center text-[10px] leading-tight">{label}</span>}
    {down ? <ArrowDown size={16} /> : <ArrowRight size={16} />}
  </div>
);
const Lane = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-lg border border-[var(--grid)] bg-[var(--plane)] p-3">
    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{title}</div>
    <div className="flex flex-wrap items-center gap-1 overflow-x-auto">{children}</div>
  </div>
);

function Legend() {
  const items: [string, string][] = [["owner", "Owner (dashboard)"], ["admin", "Admin afiliasi"], ["game", "Game / Roblox"], ["system", "Sistem ini"]];
  const cls: Record<string, string> = { owner: "border-[var(--s2)] bg-[var(--warn-bg)]", admin: "border-[var(--s3)] bg-[var(--teal-bg)]", game: "border-[var(--s1)] bg-[var(--info-bg)]", system: "border-[var(--axis)] bg-[var(--surface-2)]" };
  return <div className="flex flex-wrap gap-3 text-xs">{items.map(([k, l]) => <span key={k} className="flex items-center gap-1.5"><span className={cn("inline-block h-3 w-3 rounded-sm border-2", cls[k])} />{l}</span>)}</div>;
}

function Diagram() {
  return (
    <div className="space-y-3">
      <Legend />
      <Lane title="1 · Setup">
        <Node tone="owner" title="Owner buat Map" sub="Config → Maps, dapat ingest key" /><Arrow />
        <Node tone="game" title="Pasang key di game" sub="AffiliateClient.luau" /><Arrow />
        <Node tone="owner" title="Owner set rate" sub="komisi %, fee 30%, IDR/R$" /><Arrow />
        <Node tone="admin" title="Admin daftar" sub="/admin/register" /><Arrow label="pending" />
        <Node tone="owner" title="Owner approve" sub="atau buat admin manual" />
      </Lane>
      <Lane title="2 · Undang (atribusi)">
        <Node tone="admin" title="Admin share link" sub="…/games/start?launchData=ref_KODE" /><Arrow label="klik link" />
        <Node tone="game" title="Spender join game" sub="GetJoinData().LaunchData" /><Arrow label="POST /ingest/join" />
        <Node tone="system" title="Cek kode" sub="valid? admin aktif? bukan diri sendiri?" /><Arrow label="belum punya referrer" />
        <Node tone="system" title="Spender ↔ Admin" sub="first-touch, selamanya" />
      </Lane>
      <Lane title="3a · Spend Robux">
        <Node tone="game" title="Beli dev product" sub="ProcessReceipt" /><Arrow label="POST /ingest/robux" />
        <Node tone="system" title="Idempoten" sub="by purchaseId" /><Arrow />
        <Node tone="system" title="Potong fee 30%" sub="net R$ × IDR/R$" /><Arrow />
        <Node tone="system" title="Hitung komisi" sub="net IDR × rate" /><Arrow />
        <Node tone="system" title="Ledger +earn" sub="saldo admin naik" />
      </Lane>
      <Lane title="3b · Spend Bagi-bagi">
        <Node title="Bagi-bagi webhook" sub="proxy yang sudah ada" /><Arrow label="MessagingService" />
        <Node tone="game" title="Donasi masuk game" sub="DonationReport.luau" /><Arrow label="POST /ingest/bagibagi" />
        <Node tone="system" title="Cari spender" sub="robloxUserId → username → kata di pesan" /><Arrow label="ketemu" />
        <Node tone="system" title="Komisi + ledger" sub="tanpa potongan fee" />
        <Arrow label="tidak ketemu" /><Node tone="owner" title="Unmatched" sub="owner cocokkan manual / void" />
      </Lane>
      <Lane title="4 · Bayar & lihat">
        <Node tone="owner" title="Generate payout" sub="bulanan (preview) / ad-hoc" /><Arrow label="ledger −payout" />
        <Node tone="owner" title="Transfer & tandai dibayar" sub="referensi / bukti" /><Arrow />
        <Node tone="admin" title="Admin login portal" sub="/admin: saldo, komisi, riwayat" />
      </Lane>
    </div>
  );
}

/* ---------- checklist ---------- */

interface Setup {
  apiUrl: string; rate: { commission_bps: number; roblox_fee_bps: number; idr_per_robux: number; min_payout_idr: number } | null;
  maps: number; mapsWithPlace: number; admins: number; activeAdmins: number; pendingAdmins: number; joins: number; referredSpenders: number;
  referralAttributed: number; referralUnknownCode: number; robuxEvents: number; bagibagiEvents: number; attributedEvents: number;
  unmatched: number; ledgerEarn: number; payouts: number; paidPayouts: number;
  lastInbox: { received_at: string; status: string } | null; lastJoin: { t: string | null } | null; lastSpend: { t: string | null } | null;
}

function Step({ done, title, detail, to, action, warn }: { done: boolean; title: string; detail: React.ReactNode; to?: string; action?: string; warn?: React.ReactNode }) {
  return (
    <div className={cn("flex gap-3 border-b border-[var(--grid)] px-4 py-3 last:border-0", done ? "" : "bg-[var(--warn-bg)]")}>
      <div className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full", done ? "bg-[var(--good)] text-white" : "border-2 border-[var(--axis)] text-transparent")}>{done ? <Check size={12} strokeWidth={3} /> : <Circle size={8} />}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><div className="text-sm font-medium">{title}</div>{to && <Link to={to} className="text-xs underline">{action ?? "Buka"}</Link>}</div>
        <div className="text-xs text-[var(--ink-2)]">{detail}</div>
        {warn && <div className="mt-1 text-xs text-[var(--warn-fg)]">{warn}</div>}
      </div>
    </div>
  );
}

export function FlowPage() {
  const q = useQuery({ queryKey: ["setup"], queryFn: () => get<Setup>("/api/setup"), refetchInterval: 15_000 });
  const s = q.data;
  return (
    <>
      <PageTitle title="Alur" sub="Cara sistem ini bekerja dari undang sampai bayar, dan status setup saat ini" />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2"><CardHeader title="Diagram alur" sub="Setiap kotak = satu langkah. Panah berlabel = endpoint / kondisi." /><CardBody><Diagram /></CardBody></Card>
        <Card>
          <CardHeader title="Checklist setup" sub={s ? "Status dari data sebenarnya, refresh tiap 15 detik" : "Memuat…"} />
          {s && <>
            <Step done={!!s.rate} title="Rate komisi diset" to="/dashboard/config" action="Config"
              detail={s.rate ? `Komisi ${fmtBps(s.rate.commission_bps)} · fee Roblox ${fmtBps(s.rate.roblox_fee_bps)} · ${fmtNum(s.rate.idr_per_robux)} IDR/R$` : "Belum ada rate. Semua ingest akan ditolak (503) sampai rate dibuat."} />
            <Step done={s.mapsWithPlace > 0} title="Map dibuat dengan Place ID" to="/dashboard/config" action="Config"
              detail={s.maps ? `${s.maps} map, ${s.mapsWithPlace} aktif dengan Place ID` : "Buat map untuk dapat ingest key. Place ID dipakai untuk share link."}
              warn={s.maps > 0 && s.mapsWithPlace === 0 ? "Map ada tapi tanpa Place ID, share link tidak bisa dibuat." : undefined} />
            <Step done={s.activeAdmins > 0} title="Admin dibuat" to="/dashboard/admins" action="Admins"
              detail={s.admins ? `${s.activeAdmins} aktif dari ${s.admins}. Admin bisa daftar sendiri di /admin/register.` : "Buat admin pertama, atau minta admin daftar sendiri di /admin/register."}
              warn={s.pendingAdmins > 0 ? <Link to="/dashboard/admins" className="underline">{s.pendingAdmins} pendaftaran menunggu approval.</Link> : undefined} />
            <Step done={s.joins > 0} title="Game mengirim join" to="/dashboard/spenders" action="Spenders"
              detail={s.joins ? `${fmtNum(s.joins)} spender tercatat, terakhir ${fmtDate(s.lastJoin?.t)}` : <>Belum ada join masuk. Pasang <code>AffiliateClient.luau</code> + <code>ReferralJoin.server.luau</code>, aktifkan HTTP Requests.</>} />
            <Step done={s.referralAttributed > 0} title="Atribusi pertama berhasil" to="/dashboard/spenders" action="Spenders"
              detail={s.referralAttributed ? `${fmtNum(s.referredSpenders)} spender punya referrer` : "Belum ada spender yang join lewat share link admin."}
              warn={s.referralUnknownCode > 0 ? `${s.referralUnknownCode} join membawa kode yang tidak dikenal, cek format ref_KODE di link.` : undefined} />
            <Step done={s.robuxEvents > 0} title="Spend Robux masuk" to="/dashboard/spend?source=robux" action="Spend"
              detail={s.robuxEvents ? `${fmtNum(s.robuxEvents)} event Robux` : <>Belum ada. Gabungkan <code>ReceiptHook</code> ke <code>ProcessReceipt</code> game.</>} />
            <Step done={s.bagibagiEvents > 0} title="Donasi bagi-bagi masuk" to="/dashboard/spend?source=bagibagi" action="Spend"
              detail={s.bagibagiEvents ? `${fmtNum(s.bagibagiEvents)} event bagi-bagi` : <>Belum ada. Pasang <code>DonationReport.server.luau</code> di game.</>}
              warn={s.unmatched > 0 ? <Link to="/dashboard/spend?status=unmatched" className="underline">{s.unmatched} donasi belum cocok dengan spender, cocokkan manual.</Link> : undefined} />
            <Step done={s.ledgerEarn > 0} title="Komisi terbentuk" to="/dashboard/admins" action="Admins"
              detail={s.ledgerEarn ? `${fmtNum(s.attributedEvents)} event ter-atribusi menghasilkan komisi` : "Komisi muncul saat spender yang punya referrer melakukan spend."} />
            <Step done={s.paidPayouts > 0} title="Payout pertama dibayar" to="/dashboard/payouts" action="Payouts"
              detail={s.payouts ? `${s.payouts} payout, ${s.paidPayouts} sudah dibayar` : "Generate payout bulanan atau buat ad-hoc, lalu tandai dibayar."} />
          </>}
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader title="Aturan penting" />
        <CardBody className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
          <div><div className="font-medium">First-touch</div><div className="text-xs text-[var(--ink-2)]">Spender terikat ke admin pertama yang kodenya dia pakai, selamanya. Kode lain sesudahnya diabaikan tapi tetap dicatat.</div></div>
          <div><div className="font-medium">Robux dipotong 30%</div><div className="text-xs text-[var(--ink-2)]">1000 R$ → 700 R$ net → × 145 = Rp101.500 → komisi 10% = Rp10.150. Bagi-bagi tidak dipotong.</div></div>
          <div><div className="font-medium">Rate punya history</div><div className="text-xs text-[var(--ink-2)]">Event memakai rate yang berlaku saat transaksi. Ubah rate tidak mengubah komisi lama.</div></div>
          <div><div className="font-medium">Tidak pernah hapus</div><div className="text-xs text-[var(--ink-2)]">Salah? Void event, komisi dibalik di ledger. Payout pending bisa dibatalkan, saldo kembali. Semua tercatat di Audit.</div></div>
        </CardBody>
      </Card>
    </>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ArrowRight, Banknote, Link2, Share2, ShieldCheck, Sparkles, Users } from "lucide-react";
// Subpath supaya zod (dipakai contracts) tidak ikut ke bundle landing.
import { calcCommission, formatBps } from "@klsm/shared/commission";
import { get } from "@/lib/api";
import { fmtIdr, fmtNum } from "@/lib/format";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button, Card, Input, Label } from "@/components/ui";

interface Info {
  rate: { commission_bps: number; roblox_fee_bps: number; idr_per_robux: number; min_payout_idr: number } | null;
  maps: { name: string; placeId: number }[];
  stats: { active_admins: number; spenders: number; attributed_events: number; commission_idr: number; paid_idr: number };
}

const FALLBACK_RATE = { commission_bps: 1000, roblox_fee_bps: 3000, idr_per_robux: 145, min_payout_idr: 0 };

/** Landing page publik: menjelaskan model bisnis afiliasi ke calon admin & spender. Angka rate diambil live dari /api/public/info. */
export function LandingPage() {
  const info = useQuery({ queryKey: ["public-info"], queryFn: () => get<Info>("/api/public/info"), staleTime: 60_000 });
  const rate = info.data?.rate ?? FALLBACK_RATE;
  const st = info.data?.stats;
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-40 border-b border-[var(--grid)] bg-[var(--plane)]/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 md:px-6">
          <Link to="/" className="text-sm font-bold">KLSM Affiliate</Link>
          <nav className="ml-4 hidden gap-4 text-sm text-[var(--ink-2)] md:flex">
            <a href="#cara-kerja" className="hover:text-[var(--ink)]">Cara kerja</a><a href="#komisi" className="hover:text-[var(--ink)]">Komisi</a><a href="#aturan" className="hover:text-[var(--ink)]">Aturan</a><a href="#faq" className="hover:text-[var(--ink)]">FAQ</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link to="/admin/login"><Button size="sm" variant="outline">Login admin</Button></Link>
            <Link to="/admin/register"><Button size="sm">Daftar jadi admin</Button></Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 md:px-6">
        {/* Hero */}
        <section className="grid items-center gap-8 py-14 md:grid-cols-2 md:py-20">
          <div>
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--grid)] bg-[var(--surface)] px-3 py-1 text-xs text-[var(--ink-2)]"><Sparkles size={12} /> Program afiliasi untuk map Roblox KLSM</div>
            <h1 className="text-3xl font-semibold leading-tight md:text-5xl">Ajak teman main, dapat komisi dari setiap Robux yang mereka belanjakan.</h1>
            <p className="mt-4 max-w-xl text-base text-[var(--ink-2)]">Kamu bagikan satu link. Teman yang masuk lewat link itu tercatat sebagai undanganmu, selamanya. Setiap kali mereka beli item di dalam game atau kirim donasi bagi-bagi, <b className="text-[var(--ink)]">{formatBps(rate.commission_bps)}</b> dari nilai bersihnya jadi komisimu. Dibayar tiap bulan dalam Rupiah.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link to="/admin/register"><Button>Daftar jadi admin <ArrowRight size={14} /></Button></Link>
              <a href="#komisi"><Button variant="outline">Hitung komisimu</Button></a>
            </div>
            <p className="mt-3 text-xs text-[var(--muted)]">Gratis. Tidak ada kuota. Spender tidak membayar lebih, komisi diambil dari bagian pemilik map.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Admin aktif" value={st ? fmtNum(st.active_admins) : "…"} />
            <Stat label="Teman yang diundang" value={st ? fmtNum(st.spenders) : "…"} />
            <Stat label="Transaksi berkomisi" value={st ? fmtNum(st.attributed_events) : "…"} />
            <Stat label="Komisi sudah dibayar" value={st ? fmtIdr(st.paid_idr) : "…"} />
          </div>
        </section>

        {/* Cara kerja */}
        <section id="cara-kerja" className="scroll-mt-20 py-10">
          <h2 className="text-2xl font-semibold">Cara kerjanya</h2>
          <p className="mt-1 text-sm text-[var(--ink-2)]">Empat langkah, tidak perlu setting apa-apa di Roblox.</p>
          <div className="mt-6 grid gap-4 md:grid-cols-4">
            <Step n={1} icon={Users} title="Daftar, tunggu disetujui" text="Buat akun admin. Owner meninjau dan menyetujui. Setelah aktif, kamu dapat kode referral pribadi." />
            <Step n={2} icon={Share2} title="Bagikan share link" text={`Link Roblox berisi kodemu, satu per map${info.data?.maps.length ? ` (${info.data.maps.map((m) => m.name).join(", ")})` : ""}. Sebar di grup, bio, video, ke siapa saja.`} />
            <Step n={3} icon={Link2} title="Teman masuk lewat link" text="Begitu mereka join game lewat linkmu, mereka tercatat sebagai undanganmu. Yang pertama mengundang yang dihitung, dan itu permanen." />
            <Step n={4} icon={Banknote} title="Komisi masuk, dibayar bulanan" text="Setiap pembelian mereka di game (Robux) atau donasi bagi-bagi (Rupiah) langsung menambah saldomu. Owner membayar tiap bulan ke rekening atau e-wallet." />
          </div>
        </section>

        {/* Komisi + kalkulator */}
        <section id="komisi" className="scroll-mt-20 py-10">
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold">Berapa komisinya?</h2>
              <p className="mt-1 text-sm text-[var(--ink-2)]">Rate yang berlaku sekarang. Kalau owner mengubah rate, transaksi lama tetap memakai rate saat transaksi itu terjadi.</p>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Stat label="Komisi admin" value={formatBps(rate.commission_bps)} sub="dari nilai bersih" />
                <Stat label="Potongan Roblox" value={formatBps(rate.roblox_fee_bps)} sub="dari Robux kotor" />
                <Stat label="Kurs" value={`Rp${fmtNum(rate.idr_per_robux)}`} sub="per 1 Robux bersih" />
              </div>
              <div className="mt-4 rounded-lg border border-[var(--grid)] bg-[var(--surface)] p-4 text-sm">
                <div className="mb-2 text-xs font-medium text-[var(--muted)]">Rumus</div>
                <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-[var(--ink-2)]">{`Robux : bersih = Robux × (1 − ${formatBps(rate.roblox_fee_bps)}) × Rp${fmtNum(rate.idr_per_robux)}
Rupiah: bersih = nominal donasi
Komisi = bersih × ${formatBps(rate.commission_bps)}   (dibulatkan ke bawah)`}</pre>
                {rate.min_payout_idr > 0 && <p className="mt-2 text-xs text-[var(--muted)]">Payout bulanan dibuat kalau saldo minimal {fmtIdr(rate.min_payout_idr)}. Sisa saldo terbawa ke bulan berikutnya.</p>}
              </div>
            </div>
            <Calculator rate={rate} />
          </div>
        </section>

        {/* Untuk siapa */}
        <section className="py-10">
          <h2 className="text-2xl font-semibold">Siapa dapat apa</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <Card className="p-5"><div className="mb-2 text-sm font-semibold">Admin (kamu)</div><p className="text-sm text-[var(--ink-2)]">Punya audiens? Komunitas, grup, akun TikTok/YouTube? Kamu dapat penghasilan pasif dari setiap spend teman yang kamu bawa, tanpa modal.</p></Card>
            <Card className="p-5"><div className="mb-2 text-sm font-semibold">Spender (temanmu)</div><p className="text-sm text-[var(--ink-2)]">Main dan beli seperti biasa. Harga tidak berubah sedikit pun. Komisi admin diambil dari bagian pemilik map, bukan dari mereka.</p></Card>
            <Card className="p-5"><div className="mb-2 text-sm font-semibold">Owner (pemilik map)</div><p className="text-sm text-[var(--ink-2)]">Dapat pemain baru yang dibawa admin. Bayar komisi hanya untuk spend yang benar-benar terjadi, tercatat otomatis dari game.</p></Card>
          </div>
        </section>

        {/* Aturan */}
        <section id="aturan" className="scroll-mt-20 py-10">
          <h2 className="text-2xl font-semibold">Aturan main</h2>
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {[
              ["Yang pertama, yang dihitung", "Teman yang sudah pernah masuk lewat link admin lain tidak bisa pindah ke kamu. Ajak yang benar-benar baru."],
              ["Tidak bisa mengundang diri sendiri", "Akun Roblox milikmu sendiri tidak menghasilkan komisi."],
              ["Yang dihitung: developer product & donasi", "Pembelian game pass tidak masuk hitungan. Refund atau transaksi bermasalah bisa dibatalkan (void) dan komisinya ditarik kembali."],
              ["Transparan", "Kamu bisa lihat setiap transaksi, saldo, dan riwayat pembayaran di portal admin, atau lewat link publik tanpa login."],
              ["Dibayar bulanan", "Owner membuat payout di awal bulan sebesar saldomu, lalu mentransfer dan mencatat referensinya."],
              ["Owner menyetujui akun", "Pendaftaran ditinjau dulu supaya program ini tetap sehat. Isi username Roblox dan kontakmu saat daftar."],
            ].map(([t, d]) => <li key={t} className="flex gap-3 rounded-lg border border-[var(--grid)] bg-[var(--surface)] p-4"><ShieldCheck size={18} className="mt-0.5 shrink-0 text-[var(--s3)]" /><div><div className="text-sm font-medium">{t}</div><div className="mt-0.5 text-sm text-[var(--ink-2)]">{d}</div></div></li>)}
          </ul>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 py-10">
          <h2 className="text-2xl font-semibold">Pertanyaan umum</h2>
          <div className="mt-4 divide-y divide-[var(--grid)] rounded-lg border border-[var(--grid)] bg-[var(--surface)]">
            {[
              ["Temanku sudah klik link tapi belum muncul di portal?", "Yang dihitung adalah masuk ke game lewat link, bukan sekadar klik. Pastikan link dibuka sampai game terbuka, lebih pasti kalau Roblox belum terbuka sebelumnya."],
              ["Kapan komisi masuk?", "Otomatis, beberapa detik setelah pembelian di game tercatat. Donasi bagi-bagi masuk setelah sistem mencocokkan pengirimnya dengan pemain."],
              ["Kenapa Robux dipotong dulu?", `Roblox memotong ${formatBps(rate.roblox_fee_bps)} dari setiap pembelian sebelum sampai ke pemilik map. Komisi dihitung dari sisa yang benar-benar diterima, dikonversi ke Rupiah dengan kurs Rp${fmtNum(rate.idr_per_robux)}.`],
              ["Bisa punya lebih dari satu link?", "Satu kode referral per admin, tapi ada satu link untuk tiap map. Semua link membawa kode yang sama."],
              ["Data apa yang disimpan tentang temanku?", "Hanya userId dan username Roblox mereka, serta catatan transaksi di game. Tidak ada data pribadi lain."],
            ].map(([q, a]) => <details key={q} className="group p-4"><summary className="cursor-pointer list-none text-sm font-medium marker:hidden">{q}</summary><p className="mt-2 text-sm text-[var(--ink-2)]">{a}</p></details>)}
          </div>
        </section>

        <section className="my-10 rounded-xl border border-[var(--grid)] bg-[var(--surface)] p-8 text-center">
          <h2 className="text-2xl font-semibold">Siap mulai?</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--ink-2)]">Daftar sekarang, tunggu persetujuan owner, lalu bagikan linkmu. Semakin cepat linkmu tersebar, semakin banyak teman yang tercatat sebagai undanganmu.</p>
          <div className="mt-5 flex justify-center gap-2"><Link to="/admin/register"><Button>Daftar jadi admin</Button></Link><Link to="/admin/login"><Button variant="outline">Sudah punya akun</Button></Link></div>
        </section>
      </main>

      <footer className="border-t border-[var(--grid)] py-6 text-center text-xs text-[var(--muted)]">
        KLSM Affiliate · <Link to="/login" className="underline">Login owner</Link>
      </footer>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return <Card className="p-4"><div className="text-xs text-[var(--muted)]">{label}</div><div className="mt-1 text-xl font-semibold tnum md:text-2xl">{value}</div>{sub && <div className="mt-0.5 text-xs text-[var(--ink-2)]">{sub}</div>}</Card>;
}

function Step({ n, icon: I, title, text }: { n: number; icon: typeof Users; title: string; text: string }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ink)] text-xs font-semibold text-[var(--on-ink)]">{n}</span><I size={16} className="text-[var(--muted)]" /></div>
      <div className="text-sm font-semibold">{title}</div>
      <p className="mt-1 text-sm text-[var(--ink-2)]">{text}</p>
    </Card>
  );
}

function Calculator({ rate }: { rate: { commission_bps: number; roblox_fee_bps: number; idr_per_robux: number } }) {
  const [robux, setRobux] = useState("500");
  const [idr, setIdr] = useState("50000");
  const r = calcCommission({ grossAmount: Math.max(0, Math.floor(Number(robux) || 0)), currency: "ROBUX", rate: { commissionBps: rate.commission_bps, robloxFeeBps: rate.roblox_fee_bps, idrPerRobux: rate.idr_per_robux } });
  const d = calcCommission({ grossAmount: Math.max(0, Math.floor(Number(idr) || 0)), currency: "IDR", rate: { commissionBps: rate.commission_bps, robloxFeeBps: rate.roblox_fee_bps, idrPerRobux: rate.idr_per_robux } });
  return (
    <Card className="p-5">
      <div className="text-sm font-semibold">Kalkulator komisi</div>
      <p className="mt-0.5 text-xs text-[var(--muted)]">Angka contoh, pakai rate yang berlaku sekarang.</p>
      <div className="mt-4 space-y-4">
        <div>
          <Label>Teman beli item seharga (Robux)</Label>
          <Input inputMode="numeric" value={robux} onChange={(e) => setRobux(e.target.value.replace(/[^0-9]/g, ""))} />
          <Row k="Sisa setelah potongan Roblox" v={`${fmtNum(r.netRobux ?? 0)} R$ = ${fmtIdr(r.netIdr)}`} />
          <Row k="Komisimu" v={fmtIdr(r.commissionIdr)} strong />
        </div>
        <div>
          <Label>Teman kirim donasi bagi-bagi (Rupiah)</Label>
          <Input inputMode="numeric" value={idr} onChange={(e) => setIdr(e.target.value.replace(/[^0-9]/g, ""))} />
          <Row k="Nilai bersih" v={fmtIdr(d.netIdr)} />
          <Row k="Komisimu" v={fmtIdr(d.commissionIdr)} strong />
        </div>
      </div>
    </Card>
  );
}
function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return <div className="mt-1.5 flex items-center justify-between text-sm"><span className="text-[var(--ink-2)]">{k}</span><span className={strong ? "font-semibold text-[var(--s2)] tnum" : "tnum"}>{v}</span></div>;
}

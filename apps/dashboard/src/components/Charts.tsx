import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtCompact, fmtIdr } from "@/lib/format";

/* Palet tervalidasi (dataviz reference): s1 biru = net spend, s2 oranye = komisi, s3 aqua = bagi-bagi. Maks 2 seri per chart, satu sumbu. */
export const S1 = "var(--s1)", S2 = "var(--s2)", S3 = "var(--s3)";
const axis = { stroke: "var(--axis)", tick: { fill: "var(--muted)", fontSize: 11 }, tickLine: false, axisLine: { stroke: "var(--axis)" } } as const;

function TooltipBox({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-[var(--grid)] bg-[var(--surface)] px-3 py-2 text-xs shadow">
      <div className="mb-1 font-medium">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 tnum"><span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />{p.name}: <b>{fmtIdr(p.value)}</b></div>
      ))}
    </div>
  );
}

export interface SeriesPoint { bucket: string; net_idr: number; commission_idr: number; robux_net_idr?: number; bagibagi_net_idr?: number; events?: number }

/** Line: net spend vs komisi per bucket. */
export function SpendLine({ data, height = 260 }: { data: SeriesPoint[]; height?: number }) {
  if (!data.length) return <div className="py-12 text-center text-sm text-[var(--muted)]">Tidak ada data di rentang ini</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="bucket" {...axis} minTickGap={24} />
        <YAxis {...axis} width={56} tickFormatter={(v) => fmtCompact(Number(v))} />
        <Tooltip content={<TooltipBox />} cursor={{ stroke: "var(--axis)", strokeDasharray: "3 3" }} />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="net_idr" name="Net spend (IDR)" stroke={S1} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} isAnimationActive={false} />
        <Line type="monotone" dataKey="commission_idr" name="Komisi (IDR)" stroke={S2} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Bar: sumber Robux vs bagi-bagi per bucket (stacked, gap 2px). */
export function SourceBars({ data, height = 220 }: { data: SeriesPoint[]; height?: number }) {
  if (!data.length) return <div className="py-12 text-center text-sm text-[var(--muted)]">Tidak ada data</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="bucket" {...axis} minTickGap={24} />
        <YAxis {...axis} width={56} tickFormatter={(v) => fmtCompact(Number(v))} />
        <Tooltip content={<TooltipBox />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="robux_net_idr" name="Robux (net IDR)" stackId="a" fill={S1} stroke="var(--surface)" strokeWidth={2} isAnimationActive={false} />
        <Bar dataKey="bagibagi_net_idr" name="Bagi-bagi (IDR)" stackId="a" fill={S3} stroke="var(--surface)" strokeWidth={2} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Bar tunggal: komisi per bulan (untuk halaman admin). */
export function MonthlyBars({ data, height = 220 }: { data: { month: string; commission_idr: number }[]; height?: number }) {
  if (!data.length) return <div className="py-12 text-center text-sm text-[var(--muted)]">Belum ada komisi</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={[...data].reverse()} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} barCategoryGap="35%">
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="month" {...axis} />
        <YAxis {...axis} width={56} tickFormatter={(v) => fmtCompact(Number(v))} />
        <Tooltip content={<TooltipBox />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        <Bar dataKey="commission_idr" name="Komisi (IDR)" fill={S2} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

import { useState } from "react";
import { Button, Input } from "./ui";

export interface Range { from: string; to: string }
const day = 86_400_000;
const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; };
const preset = (days: number): Range => ({ to: endOfToday().toISOString(), from: new Date(endOfToday().getTime() - days * day + 1).toISOString() });
export const defaultRange = () => preset(30);

export function useRange() {
  const [range, setRange] = useState<Range>(defaultRange);
  return { range, setRange };
}

/** Satu baris filter di atas chart: preset + custom tanggal. */
export function RangePicker({ range, onChange, right }: { range: Range; onChange: (r: Range) => void; right?: React.ReactNode }) {
  const from = range.from.slice(0, 10), to = range.to.slice(0, 10);
  const setCustom = (f: string, t: string) => onChange({ from: new Date(f + "T00:00:00").toISOString(), to: new Date(t + "T23:59:59.999").toISOString() });
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {[7, 30, 90, 365].map((d) => <Button key={d} size="sm" variant="outline" onClick={() => onChange(preset(d))}>{d} hari</Button>)}
      <span className="mx-1 text-[var(--muted)]">|</span>
      <Input type="date" className="w-40" value={from} onChange={(e) => setCustom(e.target.value, to)} />
      <span className="text-xs text-[var(--muted)]">s/d</span>
      <Input type="date" className="w-40" value={to} onChange={(e) => setCustom(from, e.target.value)} />
      <div className="ml-auto">{right}</div>
    </div>
  );
}

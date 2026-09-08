import * as React from "react";
import { cn } from "@/lib/utils";

export function Button({ className, variant = "default", size = "md", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "outline" | "ghost" | "danger"; size?: "sm" | "md" }) {
  return (
    <button
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 ring-[var(--brand)]",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variant === "default" && "bg-[var(--brand)] text-[var(--on-brand)] hover:bg-[var(--brand-2)]",
        variant === "outline" && "border border-[var(--axis)] bg-[var(--surface)] hover:bg-[var(--surface-2)]",
        variant === "ghost" && "hover:bg-[var(--surface-3)]",
        variant === "danger" && "bg-[var(--critical)] text-white hover:opacity-90",
        className,
      )}
      {...p}
    />
  );
}

export function Input({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("h-9 w-full rounded-md border border-[var(--axis)] bg-[var(--surface)] px-3 text-sm focus:outline-none focus:ring-2 ring-[var(--brand)]", className)} {...p} />;
}
export function Select({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("h-9 rounded-md border border-[var(--axis)] bg-[var(--surface)] px-2 text-sm", className)} {...p} />;
}
export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("w-full rounded-md border border-[var(--axis)] bg-[var(--surface)] px-3 py-2 text-sm", className)} {...p} />;
}
export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-xs font-medium text-[var(--ink-2)]", className)} {...p} />;
}

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-[var(--grid)] bg-[var(--surface)]", className)} {...p} />;
}
export function CardHeader({ title, action, sub }: { title: React.ReactNode; action?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--grid)] px-4 py-3">
      <div><h3 className="text-sm font-semibold">{title}</h3>{sub && <p className="text-xs text-[var(--muted)]">{sub}</p>}</div>
      {action}
    </div>
  );
}
export function CardBody({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...p} />;
}

const tone = (t: "good" | "warn" | "bad" | "info" | "teal" | "neutral") => `bg-[var(--${t}-bg)] text-[var(--${t}-fg)] border-[var(--${t}-bd)]`;
const badgeTone: Record<string, string> = {
  attributed: tone("good"), unattributed: tone("neutral"), unmatched: tone("warn"), void: tone("bad"),
  pending: tone("warn"), paid: tone("good"), cancelled: tone("neutral"),
  active: tone("good"), inactive: tone("neutral"),
  robux: tone("info"), bagibagi: tone("teal"),
  earn: tone("good"), reversal: tone("bad"), payout: tone("info"), payout_cancel: tone("warn"), adjustment: tone("neutral"),
};
export function Badge({ value, className }: { value: string; className?: string }) {
  return <span className={cn("inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none", badgeTone[value] ?? tone("neutral"), className)}>{value}</span>;
}

export function Table({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <div className="overflow-x-auto"><table className={cn("w-full text-sm", className)} {...p} /></div>;
}
export function Th({ className, right, ...p }: React.ThHTMLAttributes<HTMLTableCellElement> & { right?: boolean }) {
  return <th className={cn("border-b border-[var(--grid)] px-3 py-2 text-left text-xs font-medium text-[var(--muted)]", right && "text-right", className)} {...p} />;
}
export function Td({ className, right, ...p }: React.TdHTMLAttributes<HTMLTableCellElement> & { right?: boolean }) {
  return <td className={cn("border-b border-[var(--grid)] px-3 py-2 align-top", right && "text-right tnum", className)} {...p} />;
}

export function Empty({ children = "Belum ada data" }: { children?: React.ReactNode }) {
  return <div className="py-10 text-center text-sm text-[var(--muted)]">{children}</div>;
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg border border-[var(--grid)] bg-[var(--surface)] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--grid)] px-4 py-3"><h3 className="text-sm font-semibold">{title}</h3><button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--ink)]">✕</button></div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "good" | "warn" }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tnum", tone === "warn" && "text-[var(--warn-fg)]", tone === "good" && "text-[var(--good-fg)]")}>{value}</div>
      {sub && <div className="mt-1 text-xs text-[var(--ink-2)]">{sub}</div>}
    </Card>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [ok, setOk] = React.useState(false);
  return (
    <Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1200); }}>
      {ok ? "Tersalin" : label}
    </Button>
  );
}

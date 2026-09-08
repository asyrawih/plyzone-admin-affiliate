import { Link } from "react-router";
import { cn } from "@/lib/utils";

export const APP_NAME = "PLYZONE AFFILIATOR";

/** Logo teks PLYZONE AFFILIATOR: kotak kuning "P" + nama. Dipakai di sidebar, login, landing, portal admin. */
export function Brand({ className, size = "md", to = "/", sub }: { className?: string; size?: "sm" | "md" | "lg"; to?: string | null; sub?: React.ReactNode }) {
  const mark = size === "lg" ? "h-8 w-8 text-base" : size === "sm" ? "h-5 w-5 text-[11px]" : "h-6 w-6 text-xs";
  const text = size === "lg" ? "text-base" : size === "sm" ? "text-xs" : "text-sm";
  const inner = (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className={cn("grid shrink-0 place-items-center rounded-md bg-[var(--brand)] font-black text-[var(--on-brand)]", mark)}>P</span>
      <span className="leading-tight">
        <span className={cn("block font-black tracking-wide text-[var(--ink)]", text)}>{APP_NAME}</span>
        {sub && <span className="block text-xs font-normal text-[var(--muted)]">{sub}</span>}
      </span>
    </span>
  );
  return to ? <Link to={to} className="hover:opacity-85">{inner}</Link> : inner;
}

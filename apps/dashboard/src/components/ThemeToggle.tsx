import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const order: Theme[] = ["system", "light", "dark"];
const label: Record<Theme, string> = { system: "Bawaan (gelap)", light: "Terang", dark: "Gelap" };
const Icon: Record<Theme, typeof Sun> = { system: Monitor, light: Sun, dark: Moon };

/** Tombol siklus tema: sistem → terang → gelap. */
export function ThemeToggle({ className, withLabel }: { className?: string; withLabel?: boolean }) {
  const [t, set] = useTheme();
  const I = Icon[t];
  const next = order[(order.indexOf(t) + 1) % order.length]!;
  return (
    <button type="button" onClick={() => set(next)} title={`Tema: ${label[t]} (klik: ${label[next]})`} aria-label={`Tema ${label[t]}`}
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--axis)] bg-[var(--surface)] px-2 text-xs text-[var(--ink-2)] hover:bg-[var(--surface-2)]", className)}>
      <I size={14} />{withLabel && <span>{label[t]}</span>}
    </button>
  );
}

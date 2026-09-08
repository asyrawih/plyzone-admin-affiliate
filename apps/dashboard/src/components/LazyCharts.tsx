import { lazy, Suspense, type ComponentProps } from "react";

/** Recharts (~400 KB) dimuat hanya saat chart pertama dirender, bukan di bundle awal. Pakai ini, bukan ./Charts, di halaman. */
type C = typeof import("./Charts");
export type { SeriesPoint } from "./Charts";

const LSpendLine = lazy(() => import("./Charts").then((m) => ({ default: m.SpendLine })));
const LSourceBars = lazy(() => import("./Charts").then((m) => ({ default: m.SourceBars })));
const LMonthlyBars = lazy(() => import("./Charts").then((m) => ({ default: m.MonthlyBars })));

function Skeleton({ height }: { height: number }) {
  return <div style={{ height }} className="animate-pulse rounded bg-[var(--surface-3)]" aria-busy="true" />;
}

export function SpendLine(p: ComponentProps<C["SpendLine"]>) { return <Suspense fallback={<Skeleton height={p.height ?? 260} />}><LSpendLine {...p} /></Suspense>; }
export function SourceBars(p: ComponentProps<C["SourceBars"]>) { return <Suspense fallback={<Skeleton height={p.height ?? 220} />}><LSourceBars {...p} /></Suspense>; }
export function MonthlyBars(p: ComponentProps<C["MonthlyBars"]>) { return <Suspense fallback={<Skeleton height={p.height ?? 220} />}><LMonthlyBars {...p} /></Suspense>; }

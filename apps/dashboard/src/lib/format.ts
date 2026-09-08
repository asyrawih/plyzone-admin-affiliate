const idr = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("id-ID");
export const fmtIdr = (n: number | string | null | undefined) => idr.format(Number(n ?? 0));
export const fmtNum = (n: number | string | null | undefined) => num.format(Number(n ?? 0));
export const fmtCompact = (n: number) => new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n);
export const fmtDate = (s: string | null | undefined) => s ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(s)) : "-";
export const fmtDay = (s: string | null | undefined) => s ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" }).format(new Date(s)) : "-";
export const fmtBps = (bps: number) => `${(bps / 100).toLocaleString("id-ID")}%`;
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

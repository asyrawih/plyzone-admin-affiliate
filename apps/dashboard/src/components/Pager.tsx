import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { get } from "@/lib/api";
import { fmtNum } from "@/lib/format";
import { Button } from "@/components/ui";

export interface PagedResult<T> { rows: T[]; total: number; limit: number; offset: number }

/**
 * Ambil list berhalaman dari endpoint yang mengembalikan { rows, total, limit, offset }.
 * `urlKey` = simpan nomor halaman di query string (?page=2) supaya tahan refresh; tanpa itu disimpan di state lokal.
 * Ganti `url` (filter berubah) otomatis kembali ke halaman 1.
 */
export function usePaged<T = any>(url: string | null, opts: { limit?: number; urlKey?: string; enabled?: boolean; queryKey?: unknown[] } = {}) {
  const limit = opts.limit ?? 50;
  const [sp, setSp] = useSearchParams();
  const [local, setLocal] = useState(0);
  const [lastUrl, setLastUrl] = useState(url);
  if (url !== lastUrl) { setLastUrl(url); if (!opts.urlKey) setLocal(0); }
  const page = opts.urlKey ? Math.max(0, (Number(sp.get(opts.urlKey)) || 1) - 1) : local;
  const setPage = (p: number) => {
    if (!opts.urlKey) return setLocal(p);
    const n = new URLSearchParams(sp); p > 0 ? n.set(opts.urlKey, String(p + 1)) : n.delete(opts.urlKey); setSp(n, { replace: true });
  };
  const offset = page * limit;
  const full = url ? `${url}${url.includes("?") ? "&" : "?"}limit=${limit}&offset=${offset}` : null;
  const q = useQuery<PagedResult<T>>({ queryKey: [...(opts.queryKey ?? ["paged", url]), limit, offset], queryFn: () => get<PagedResult<T>>(full!), enabled: !!full && (opts.enabled ?? true), placeholderData: (prev) => prev });
  const total = q.data?.total ?? 0;
  return { rows: q.data?.rows ?? [], total, page, setPage, limit, offset, isLoading: q.isLoading, isFetching: q.isFetching, error: q.error, data: q.data };
}

/** Baris navigasi halaman. Sembunyi kalau semua muat di satu halaman. */
export function Pager({ total, limit, page, onPage, unit = "baris", className = "" }: { total: number; limit: number; page: number; onPage: (p: number) => void; unit?: string; className?: string }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total <= limit && page === 0) return total ? <div className={`px-3 py-2 text-xs text-[var(--muted)] ${className}`}>{fmtNum(total)} {unit}</div> : null;
  const from = page * limit + 1, to = Math.min(total, (page + 1) * limit);
  return (
    <div className={`flex items-center justify-between gap-2 border-t border-[var(--grid)] px-3 py-2 text-xs ${className}`}>
      <span className="text-[var(--muted)]">{total ? `${fmtNum(from)}–${fmtNum(to)} dari ${fmtNum(total)} ${unit}` : `0 ${unit}`}</span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => onPage(0)} title="Halaman pertama">«</Button>
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => onPage(page - 1)}>‹</Button>
        <span className="px-2">hal {fmtNum(page + 1)} / {fmtNum(pages)}</span>
        <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>›</Button>
        <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => onPage(pages - 1)} title="Halaman terakhir">»</Button>
      </div>
    </div>
  );
}

import { useSyncExternalStore } from "react";

/**
 * Pemilih map global untuk dashboard owner. Disimpan di localStorage supaya bertahan antar halaman & refresh.
 * `undefined` = semua map. Halaman menyertakan mapId ke queryKey dan query string endpoint.
 */
const KEY = "klsm-map";
const listeners = new Set<() => void>();
function read(): number | undefined {
  try { const v = Number(localStorage.getItem(KEY)); return v > 0 ? v : undefined; } catch { return undefined; }
}
let current = read();
export function setMapFilter(id: number | undefined) {
  current = id;
  try { id ? localStorage.setItem(KEY, String(id)) : localStorage.removeItem(KEY); } catch { /* abaikan */ }
  listeners.forEach((l) => l());
}
export function useMapFilter(): number | undefined {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current, () => undefined);
}
/** Tambah &mapId= ke query string kalau ada filter. */
export function mapQs(mapId: number | undefined, sep: "?" | "&" = "&") { return mapId ? `${sep}mapId=${mapId}` : ""; }

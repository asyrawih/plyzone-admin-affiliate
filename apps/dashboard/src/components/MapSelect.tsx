import { useQuery } from "@tanstack/react-query";
import { Map as MapIcon } from "lucide-react";
import { get } from "@/lib/api";
import { setMapFilter, useMapFilter } from "@/lib/mapFilter";
import { cn } from "@/lib/utils";

/** Dropdown map di sidebar: "Semua map" atau satu map. Nilainya dipakai semua halaman owner. */
export function MapSelect({ className }: { className?: string } = {}) {
  const mapId = useMapFilter();
  const maps = useQuery({ queryKey: ["maps"], queryFn: () => get<{ maps: any[] }>("/api/config/maps"), staleTime: 60_000 });
  const list = maps.data?.maps ?? [];
  if (!list.length) return null;
  return (
    <label className={cn("flex items-center gap-2 rounded-md border border-[var(--grid)] bg-[var(--plane)] px-2 py-1.5 text-xs", className ?? "mx-2 mb-2")}>
      <MapIcon size={14} className="shrink-0 text-[var(--muted)]" />
      <select className="w-full bg-transparent text-xs outline-none" value={mapId ?? ""} onChange={(e) => setMapFilter(e.target.value ? Number(e.target.value) : undefined)} aria-label="Filter map">
        <option value="">Semua map</option>
        {list.map((m) => <option key={m.id} value={m.id}>{m.name}{m.is_active ? "" : " (nonaktif)"}</option>)}
      </select>
    </label>
  );
}

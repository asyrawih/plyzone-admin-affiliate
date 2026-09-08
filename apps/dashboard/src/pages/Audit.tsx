import { fmtDate } from "@/lib/format";
import { PageTitle } from "@/components/Layout";
import { Pager, usePaged } from "@/components/Pager";
import { Card, Empty, Table, Td, Th } from "@/components/ui";

export function AuditPage() {
  const q = usePaged<any>("/api/audit", { limit: 50, urlKey: "page", queryKey: ["audit"] });
  return (
    <>
      <PageTitle title="Audit log" sub="Semua aksi owner" />
      <Card><Table><thead><tr><Th>Waktu</Th><Th>Aktor</Th><Th>Aksi</Th><Th>Entitas</Th><Th>Detail</Th></tr></thead>
        <tbody>{q.rows.map((a) => <tr key={a.id}><Td className="text-xs whitespace-nowrap">{fmtDate(a.created_at)}</Td><Td className="text-xs">{a.actor_username ?? "-"}</Td><Td><code className="text-xs">{a.action}</code></Td><Td className="text-xs">{a.entity} #{a.entity_id}</Td>
          <Td><details className="text-xs"><summary className="cursor-pointer text-[var(--muted)]">lihat</summary><pre className="mt-1 max-w-xl overflow-x-auto whitespace-pre-wrap rounded bg-[var(--surface-3)] p-2">{a.before ? `before: ${a.before}\n` : ""}{a.after ? `after: ${a.after}` : ""}</pre></details></Td></tr>)}</tbody></Table>
        {!q.rows.length && !q.isLoading && <Empty />}
        <Pager total={q.total} limit={q.limit} page={q.page} onPage={q.setPage} unit="aksi" /></Card>
    </>
  );
}

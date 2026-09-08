/**
 * Dijalankan saat build image: INSTALL ekstensi `postgres` DuckDB ke folder di dalam image,
 * supaya pod tidak mengunduh dari extensions.duckdb.org saat start (tanpa internet pun jalan).
 *   DUCKDB_EXTENSION_DIR=/app/.duckdb/extensions bun run packages/analytics/scripts/install-ext.ts
 */
import { DuckDBInstance } from "@duckdb/node-api";
import { readdirSync } from "node:fs";

const dir = process.env.DUCKDB_EXTENSION_DIR;
if (!dir) { console.error("DUCKDB_EXTENSION_DIR wajib"); process.exit(2); }
const instance = await DuckDBInstance.create(":memory:", { extension_directory: dir });
const conn = await instance.connect();
await conn.run(`SET extension_directory = '${dir.replace(/'/g, "''")}'`);
await conn.run("INSTALL postgres");
await conn.run("LOAD postgres");
const files: string[] = [];
const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(`${d}/${e.name}`) : files.push(`${d}/${e.name}`); };
walk(dir);
if (!files.some((f) => f.endsWith(".duckdb_extension"))) { console.error("ekstensi tidak ditemukan di", dir, files); process.exit(1); }
console.log("duckdb postgres ext ok:", files.filter((f) => f.endsWith(".duckdb_extension")).join(", "));
conn.closeSync(); instance.closeSync();

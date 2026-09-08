// Dijalankan setelah `vite build`: buat .gz dan .br untuk aset teks di dist/, disajikan oleh hono serveStatic({ precompressed: true }).
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const dist = join(import.meta.dir, "..", "dist");
const exts = new Set([".js", ".css", ".html", ".svg", ".json", ".txt", ".map"]);
let n = 0, before = 0, after = 0;
function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    const ext = name.slice(name.lastIndexOf("."));
    if (!exts.has(ext) || name.endsWith(".gz") || name.endsWith(".br")) continue;
    const buf = readFileSync(p);
    if (buf.length < 1024) continue;
    const br = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
    writeFileSync(p + ".br", br);
    writeFileSync(p + ".gz", gzipSync(buf, { level: 9 }));
    n++; before += buf.length; after += br.length;
  }
}
walk(dist);
console.log(`[precompress] ${n} file, ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB (brotli)`);

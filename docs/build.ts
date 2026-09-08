/**
 * Bikin docs/index.html dari docs/src/page.html.
 * Placeholder {{FILE:path}} diganti isi file (di-escape), jadi kode Luau di docs selalu sama dengan roblox/*.luau.
 *
 *   bun run docs/build.ts            → docs/index.html
 *   bun run docs/build.ts out.html   → juga tulis versi tanpa <html>/<head>/<body> (untuk artifact/embed)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const tpl = readFileSync(resolve(root, "docs/src/page.html"), "utf8");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const filled = tpl.replace(/\{\{FILE:([^}]+)\}\}/g, (_m, p: string) =>
  esc(readFileSync(resolve(root, p.trim()), "utf8").trimEnd()),
);
const [head, body] = filled.split("<!--BODY-->");
if (body === undefined) throw new Error("template harus punya penanda <!--BODY-->");

const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head.trim()}
</head>
<body>
${body.trim()}
</body>
</html>
`;
writeFileSync(resolve(root, "docs/index.html"), html);
console.log("docs/index.html ditulis (" + (html.length / 1024).toFixed(0) + " KB)");

const extra = process.argv[2];
if (extra) {
  writeFileSync(extra, head.trim() + "\n" + body.trim() + "\n");
  console.log("versi embed ditulis ke " + extra);
}

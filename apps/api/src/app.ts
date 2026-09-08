import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { compress } from "hono/compress";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { AppContext, Vars } from "./context";
import { requireOwner } from "./middleware/session";
import { rateLimit } from "./middleware/rateLimit";
import { ingestRoutes } from "./routes/ingest";
import { webhookRoutes } from "./routes/webhook";
import { authRoutes } from "./routes/auth";
import { adminRoutes } from "./routes/owner/admins";
import { configRoutes } from "./routes/owner/config";
import { spendRoutes, spenderRoutes } from "./routes/owner/spend";
import { payoutRoutes } from "./routes/owner/payouts";
import { analyticsRoutes, auditRoutes } from "./routes/analytics";
import { publicRoutes } from "./routes/public";
import { setupRoutes } from "./routes/owner/setup";
import { riskRoutes } from "./routes/owner/risk";
import { adminAuthRoutes } from "./routes/adminAuth";
import { adminPortalRoutes } from "./routes/adminPortal";
import { publicInfoRoutes } from "./routes/publicInfo";

export function createApp(ctx: AppContext, opts: { log?: boolean } = {}) {
  const app = new Hono<{ Variables: Vars }>();
  if (opts.log) app.use("*", logger());
  app.use("*", async (c, next) => { c.set("ctx", ctx); await next(); });
  app.use("/api/*", cors({ origin: ctx.config.dashboardOrigin, credentials: true }));
  // JSON list bisa puluhan-ratusan KB; gzip/brotli on-the-fly (Bun punya CompressionStream).
  app.use("/api/*", compress());
  app.use("/a/*", compress());

  app.get("/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));

  app.route("/ingest", ingestRoutes);
  app.route("/webhook", webhookRoutes);
  app.route("/api/auth", authRoutes);
  app.route("/api/admin-auth", adminAuthRoutes);
  app.route("/api/admin-portal", adminPortalRoutes);
  app.route("/api/public", publicInfoRoutes);   // landing page, tanpa auth; harus sebelum router owner

  const owner = new Hono<{ Variables: Vars }>();
  owner.use("*", requireOwner);
  owner.route("/admins", adminRoutes);
  owner.route("/config", configRoutes);
  owner.route("/spend-events", spendRoutes);
  owner.route("/spenders", spenderRoutes);
  owner.route("/payouts", payoutRoutes);
  owner.route("/analytics", analyticsRoutes);
  owner.route("/audit", auditRoutes);
  owner.route("/setup", setupRoutes);
  owner.route("/risk", riskRoutes);
  app.route("/api", owner);

  app.use("/a/*", rateLimit(ctx.config.publicRateLimit));
  const wantsHtml = (accept: string | undefined) => !!accept && accept.includes("text/html");
  const staticDir = ctx.config.staticDir && existsSync(ctx.config.staticDir) ? ctx.config.staticDir : null;
  // index.html tidak boleh di-cache (isinya menunjuk ke hash aset terbaru); aset ber-hash di /assets boleh di-cache selamanya.
  const spa = async (c: import("hono").Context) => { c.header("Cache-Control", "no-cache"); return c.html(await Bun.file(join(staticDir!, "index.html")).text()); };
  if (staticDir) {
    // Browser membuka /a/:token langsung → kirim SPA; fetch() dari SPA (accept: application/json) → JSON.
    app.get("/a/:token", async (c, next) => (wantsHtml(c.req.header("accept")) ? spa(c) : next()));
  }
  app.route("/a", publicRoutes);
  if (staticDir) {
    // precompressed: kirim .br/.gz hasil build (apps/dashboard/scripts/precompress.ts) kalau browser mendukung.
    app.use("/assets/*", serveStatic({ root: staticDir, precompressed: true, onFound: (_path, c) => c.header("Cache-Control", "public, max-age=31536000, immutable") }));
    app.use("/*", serveStatic({ root: staticDir, precompressed: true, onFound: (_path, c) => c.header("Cache-Control", "no-cache") }));
    app.get("/*", async (c) => (wantsHtml(c.req.header("accept")) ? spa(c) : c.json({ error: "not found" }, 404)));
    console.log(`[api] dashboard disajikan dari ${staticDir}`);
  }

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal error", message: err.message }, 500);
  });
  return app;
}

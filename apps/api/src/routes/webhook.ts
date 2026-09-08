import { Hono } from "hono";
import { BagiBagiWebhookSchema } from "@klsm/shared";
import { inbox } from "@klsm/db";
import type { Vars } from "../context";
import { verifyWebhook } from "../middleware/webhookAuth";
import { NoRateError, recordBagiBagiSpend } from "../services/spend";

export const webhookRoutes = new Hono<{ Variables: Vars }>();

webhookRoutes.post("/bagibagi", async (c) => {
  const ctx = c.get("ctx");
  const raw = await c.req.text();
  const headers = Object.fromEntries([...c.req.raw.headers.entries()].filter(([k]) => !/cookie|authorization/i.test(k)));
  const authErr = await verifyWebhook(ctx.config, c.req.raw, raw);
  if (authErr) {
    await inbox.create(ctx.db, { source: "bagibagi", headers, body: raw, authOk: false, status: "rejected", error: authErr });
    return c.json({ ok: false, error: authErr }, 401);
  }
  let json: unknown;
  try { json = JSON.parse(raw); } catch {
    await inbox.create(ctx.db, { source: "bagibagi", headers, body: raw, authOk: true, status: "invalid", error: "bukan JSON" });
    return c.json({ ok: false, error: "bukan JSON" }, 400);
  }
  const parsed = BagiBagiWebhookSchema.safeParse(json);
  if (!parsed.success) {
    await inbox.create(ctx.db, { source: "bagibagi", headers, body: raw, authOk: true, status: "invalid", error: JSON.stringify(parsed.error.issues) });
    return c.json({ ok: false, error: "payload tidak valid", issues: parsed.error.issues }, 400);
  }
  const row = await inbox.create(ctx.db, { source: "bagibagi", headers, body: raw, authOk: true, status: "ok" });
  try {
    const r = await recordBagiBagiSpend(ctx, {
      externalId: parsed.data.externalId, donorName: parsed.data.donorName, amountIdr: parsed.data.amountIdr,
      message: parsed.data.message, username: parsed.data.username, occurredAt: parsed.data.occurredAt ?? new Date().toISOString(), raw: parsed.data.raw,
    });
    await inbox.finish(ctx.db, row.id, r.duplicate ? "duplicate" : "ok", null, r.event.id);
    return c.json({ ok: true, duplicate: r.duplicate, eventId: r.event.id, status: r.event.status, candidates: r.candidates });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await inbox.finish(ctx.db, row.id, "error", msg, null);
    if (e instanceof NoRateError) return c.json({ ok: false, error: msg }, 503);
    throw e;
  }
});

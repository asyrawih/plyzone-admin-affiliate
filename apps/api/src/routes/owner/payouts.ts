import { Hono } from "hono";
import { CreatePayoutSchema, GenerateMonthlySchema, MarkPaidSchema } from "@klsm/shared";
import { payouts } from "@klsm/db";
import type { Vars } from "../../context";
import { PageQuery, idParam, paged, parseBody, parseQuery } from "../../http";
import { z } from "zod";
import { cancelPayout, createAdhoc, generateMonthly, markPaid, previewMonthly } from "../../services/payout";

export const payoutRoutes = new Hono<{ Variables: Vars }>();

const PayoutListQuery = PageQuery.extend({ status: z.enum(["pending", "paid", "cancelled"]).optional(), adminId: z.coerce.number().int().optional() });

payoutRoutes.get("/", async (c) => {
  const q = parseQuery(c, PayoutListQuery); if (!q.ok) return q.res;
  return c.json(paged(q.data, await payouts.list(c.get("ctx").db, q.data)));
});

payoutRoutes.post("/", async (c) => {
  const p = await parseBody(c, CreatePayoutSchema); if (!p.ok) return p.res;
  try { return c.json({ payout: await createAdhoc(c.get("ctx").db, p.data, c.get("userId")!) }, 201); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
});

payoutRoutes.post("/generate-monthly", async (c) => {
  const { db, config } = c.get("ctx");
  const p = await parseBody(c, GenerateMonthlySchema); if (!p.ok) return p.res;
  if (p.data.dryRun) return c.json({ preview: await previewMonthly(db, p.data.month, config.tz) });
  return c.json({ created: await generateMonthly(db, p.data.month, config.tz, c.get("userId")!) }, 201);
});

payoutRoutes.post("/:id/paid", async (c) => {
  const id = idParam(c); if (!id) return c.json({ error: "id" }, 400);
  const p = await parseBody(c, MarkPaidSchema); if (!p.ok) return p.res;
  try { return c.json({ payout: await markPaid(c.get("ctx").db, id, p.data, c.get("userId")!) }); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
});

payoutRoutes.post("/:id/cancel", async (c) => {
  const id = idParam(c); if (!id) return c.json({ error: "id" }, 400);
  try { return c.json({ payout: await cancelPayout(c.get("ctx").db, id, c.get("userId")!) }); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
});

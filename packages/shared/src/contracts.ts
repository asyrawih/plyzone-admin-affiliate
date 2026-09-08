import { z } from "zod";

/** Tanggal ISO atau unix detik/milidetik. Dinormalisasi ke ISO UTC oleh server. */
export const flexibleDate = z
  .union([z.string().min(1), z.number()])
  .optional()
  .nullable()
  .transform((v) => {
    if (v === undefined || v === null || v === "") return undefined;
    let d: Date;
    if (typeof v === "number") d = new Date(v < 1e12 ? v * 1000 : v);
    else if (/^\d+$/.test(v)) {
      const n = Number(v);
      d = new Date(n < 1e12 ? n * 1000 : n);
    } else d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  });

// ---------- Ingest dari game ----------

export const IngestJoinSchema = z.object({
  robloxUserId: z.coerce.number().int().positive(),
  username: z.string().min(1).max(50),
  displayName: z.string().max(50).optional(),
  /** Mentah dari GetJoinData().LaunchData, boleh kosong. */
  launchData: z.string().max(200).optional().nullable(),
  /** GetJoinData().ReferredByPlayerId: UserId pengundang kalau masuk lewat undangan Roblox. */
  referredByRobloxUserId: z.coerce.number().int().positive().optional().nullable(),
  /** Diagnostik: isi GetJoinData apa adanya (SourceGameId, SourcePlaceId, ReferredByPlayerId, LaunchData, dsb) + berapa detik game menunggu. */
  joinData: z.record(z.string(), z.unknown()).optional().nullable(),
  waitedSeconds: z.coerce.number().optional().nullable(),
  joinedAt: flexibleDate,
});
export type IngestJoin = z.infer<typeof IngestJoinSchema>;

export const IngestRobuxSchema = z.object({
  /** ReceiptInfo.PurchaseId, unik global dari Roblox. */
  purchaseId: z.string().min(1).max(128),
  robloxUserId: z.coerce.number().int().positive(),
  username: z.string().max(50).optional(),
  productId: z.coerce.number().int().optional(),
  /** ReceiptInfo.CurrencySpent (Robux kotor). Di Studio selalu 0; game lalu mengisi dari harga produk. */
  currencySpent: z.coerce.number().int().nonnegative(),
  /** "receipt" (default) atau "product_info" kalau game mengambil harga dari GetProductInfo. */
  priceSource: z.enum(["receipt", "product_info"]).optional(),
  currencyType: z.string().optional(),
  placeId: z.coerce.number().int().optional(),
  purchasedAt: flexibleDate,
});
export type IngestRobux = z.infer<typeof IngestRobuxSchema>;

// ---------- Webhook bagi-bagi ----------

/** Nominal bisa "Rp 50.000", "50000", 50000. */
export const rupiahAmount = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === "number" ? Math.floor(v) : Number(String(v).replace(/[^\d]/g, ""));
  if (!Number.isFinite(n) || n < 0) {
    ctx.addIssue({ code: "custom", message: "amount tidak valid" });
    return z.NEVER;
  }
  return n;
});

export const BagiBagiWebhookSchema = z
  .object({
    id: z.string().min(1).optional(),
    transaction_id: z.string().min(1).optional(),
    name: z.string().optional(),
    donator_name: z.string().optional(),
    amount: rupiahAmount,
    message: z.string().optional().default(""),
    /** Kalau proxy sudah mengekstrak username, kirim di sini. */
    username: z.string().optional(),
    created_at: flexibleDate,
    createdAt: flexibleDate,
  })
  .passthrough()
  .transform((v) => ({
    externalId: v.id ?? v.transaction_id ?? "",
    donorName: v.name ?? v.donator_name ?? "",
    amountIdr: v.amount,
    message: v.message ?? "",
    username: v.username,
    occurredAt: v.created_at ?? v.createdAt,
    raw: v,
  }))
  .refine((v) => v.externalId.length > 0, { message: "id / transaction_id wajib" });
export type BagiBagiWebhook = z.infer<typeof BagiBagiWebhookSchema>;

/**
 * Donasi bagi-bagi dilaporkan dari GAME SERVER (setelah event donasi masuk ke game lewat MessagingService).
 * Kalau game sudah tahu player-nya (donatur ada di server), kirim robloxUserId supaya match langsung.
 */
export const IngestBagiBagiSchema = z.object({
  /** id transaksi bagi-bagi, unik. */
  id: z.string().min(1).max(128),
  donorName: z.string().max(200).default(""),
  amountIdr: rupiahAmount,
  message: z.string().max(2000).optional().default(""),
  /** Username kandidat hasil parsing di game (opsional). */
  username: z.string().max(50).optional(),
  /** Kalau game berhasil mencocokkan donatur ke player di server. */
  robloxUserId: z.coerce.number().int().positive().optional(),
  occurredAt: flexibleDate,
});
export type IngestBagiBagi = z.infer<typeof IngestBagiBagiSchema>;

// ---------- Owner API ----------

export const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const CreateAdminSchema = z.object({
  displayName: z.string().min(1).max(80),
  robloxUserId: z.coerce.number().int().positive().optional().nullable(),
  robloxUsername: z.string().max(50).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
export const UpdateAdminSchema = CreateAdminSchema.partial().extend({
  status: z.enum(["pending", "active", "inactive"]).optional(),
});

export const CreateRateSchema = z.object({
  commissionBps: z.coerce.number().int().min(0).max(10_000),
  robloxFeeBps: z.coerce.number().int().min(0).max(10_000).default(3000),
  idrPerRobux: z.coerce.number().int().min(0),
  minPayoutIdr: z.coerce.number().int().min(0).default(0),
  effectiveFrom: flexibleDate,
  /** Masa tahan komisi sebelum bisa dibayar, jam. */
  holdHours: z.coerce.number().int().min(0).max(24 * 60).default(72),
  /** >0: laporan bagi-bagi dari game ditahan (review) sampai webhook proxy yang cocok datang dalam sekian jam. 0 = mati. */
  bagibagiConfirmHours: z.coerce.number().int().min(0).max(24 * 30).default(0),
});

/** Katalog produk yang dikirim game saat server start, atau diisi owner di Config. */
export const ProductItemSchema = z.object({
  productId: z.coerce.number().int().positive(),
  name: z.string().max(120).optional().nullable(),
  priceRobux: z.coerce.number().int().min(0),
  isActive: z.boolean().optional(),
  locked: z.boolean().optional(),
});
export const IngestProductsSchema = z.object({ products: z.array(ProductItemSchema).max(500) });
export const UpsertProductsSchema = IngestProductsSchema;
export const ResolveRiskSchema = z.object({ note: z.string().max(500).optional() });
export const ApproveReviewSchema = z.object({ note: z.string().max(500).optional() });

export const CreateMapSchema = z.object({
  name: z.string().min(1).max(80),
  universeId: z.coerce.number().int().positive().optional().nullable(),
  placeId: z.coerce.number().int().positive().optional().nullable(),
});
export const UpdateMapSchema = CreateMapSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const MatchSpendSchema = z.object({
  spenderRobloxUserId: z.coerce.number().int().positive().optional(),
  spenderId: z.coerce.number().int().positive().optional(),
}).refine((v) => v.spenderId || v.spenderRobloxUserId, { message: "spenderId atau spenderRobloxUserId wajib" });

export const VoidSpendSchema = z.object({ reason: z.string().min(1).max(500) });

export const CreatePayoutSchema = z.object({
  adminId: z.coerce.number().int().positive(),
  amountIdr: z.coerce.number().int().positive(),
  method: z.string().max(80).optional(),
  reference: z.string().max(200).optional(),
  note: z.string().max(500).optional(),
});

export const GenerateMonthlySchema = z.object({
  /** "2026-08" */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  dryRun: z.boolean().default(false),
});

export const MarkPaidSchema = z.object({
  method: z.string().max(80).optional(),
  reference: z.string().max(200).optional(),
  proofUrl: z.string().max(500).optional(),
});

export const RangeQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  adminId: z.coerce.number().int().optional(),
  mapId: z.coerce.number().int().optional(),
  granularity: z.enum(["day", "week", "month"]).default("day"),
});

// ---------- Admin self-service ----------

export const usernameField = z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_.]+$/, "huruf, angka, _ . saja");
export const passwordField = z.string().min(8).max(200);

export const AdminRegisterSchema = z.object({
  username: usernameField,
  password: passwordField,
  displayName: z.string().trim().min(1).max(80),
  robloxUsername: z.string().trim().max(50).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const AdminLoginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });

export const ChangePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordField });

/** Kode referral pilihan admin: 4-12 huruf/angka, disimpan huruf besar, hanya bisa diset sekali. */
export const ReferralCodeSchema = z.object({
  code: z.string().trim().min(4).max(12).regex(/^[A-Za-z0-9]+$/, "huruf dan angka saja").transform((v) => v.toUpperCase()),
});

/** Owner memberi / mengganti login admin yang dibuat manual. */
export const SetAdminLoginSchema = z.object({ username: usernameField, password: passwordField });

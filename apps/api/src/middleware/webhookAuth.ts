import type { Config } from "../config";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function hmacHex(secret: string, body: string): Promise<{ hex: string; b64: string }> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const hex = Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
  const b64 = btoa(String.fromCharCode(...sig));
  return { hex, b64 };
}

/**
 * Lolos kalau: tidak ada secret dikonfigurasi (dev), atau shared secret cocok, atau HMAC cocok.
 * Return alasan gagal (string) atau null kalau ok.
 */
export async function verifyWebhook(cfg: Config, req: Request, rawBody: string): Promise<string | null> {
  const noAuthConfigured = !cfg.webhookSharedSecret && !cfg.webhookHmacSecret;
  if (noAuthConfigured) return null;

  if (cfg.webhookSharedSecret) {
    const url = new URL(req.url);
    const provided = req.headers.get("x-webhook-secret") ?? url.searchParams.get("secret") ?? "";
    if (provided && timingSafeEqual(provided, cfg.webhookSharedSecret)) return null;
  }
  if (cfg.webhookHmacSecret) {
    const raw = (req.headers.get("x-signature") ?? req.headers.get("x-bagibagi-signature") ?? "").replace(/^sha256=/i, "").trim();
    if (raw) {
      const { hex, b64 } = await hmacHex(cfg.webhookHmacSecret, rawBody);
      if (timingSafeEqual(raw.toLowerCase(), hex) || timingSafeEqual(raw, b64)) return null;
    }
  }
  return "signature/secret tidak cocok";
}

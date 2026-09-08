const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // tanpa 0/O/1/I biar gak ambigu

function randomFrom(alphabet: string, len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}

/** Kode referral pendek untuk launchData, contoh: "K7PQ2M". */
export function generateReferralCode(len = 6): string {
  return randomFrom(ALPHABET, len);
}

/** Token halaman publik admin, 32 byte hex. */
export function generatePublicToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Key ingest untuk game server. Ditampilkan sekali ke owner, disimpan hash-nya. */
export function generateIngestKey(): string {
  return "mk_" + generatePublicToken();
}

export const LAUNCH_DATA_PREFIX = "ref_";

/** Bentuk launchData yang dibaca game: "ref_K7PQ2M". */
export function buildLaunchData(referralCode: string): string {
  return LAUNCH_DATA_PREFIX + referralCode;
}

/** Ambil kode dari launchData mentah. Toleran terhadap spasi & huruf kecil. */
export function parseLaunchData(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const m = /^ref[_-]?([A-Za-z0-9]{4,16})$/i.exec(s);
  return m ? m[1]!.toUpperCase() : null;
}

export function buildShareLink(placeId: number | string, referralCode: string): string {
  const params = new URLSearchParams({
    placeId: String(placeId),
    launchData: buildLaunchData(referralCode),
  });
  return `https://www.roblox.com/games/start?${params.toString()}`;
}

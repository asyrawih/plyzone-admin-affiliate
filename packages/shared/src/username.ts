/**
 * Ekstrak kandidat username Roblox dari payload donasi.
 * Aturan username Roblox: 3-20 karakter, huruf/angka/underscore (maks satu underscore, tidak di awal/akhir).
 */
const USERNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|_(?!_)){1,18}[A-Za-z0-9]$/;

export function isValidRobloxUsername(s: string): boolean {
  if (!USERNAME_RE.test(s)) return false;
  return (s.match(/_/g) ?? []).length <= 1;
}

export interface UsernameCandidates {
  /** Urutan prioritas: field eksplisit, nama donatur, lalu mention di pesan. */
  candidates: string[];
}

export function extractUsernameCandidates(input: {
  username?: string | null;
  name?: string | null;
  message?: string | null;
}): string[] {
  const out: string[] = [];
  const push = (s: string | null | undefined) => {
    if (!s) return;
    const t = s.trim().replace(/^@/, "");
    if (isValidRobloxUsername(t) && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  push(input.username);
  push(input.name);
  // "@user" atau "user:" atau "un: user" di dalam pesan
  const msg = input.message ?? "";
  for (const m of msg.matchAll(/(?:@|\b(?:un|user|username)\s*[:=]\s*)([A-Za-z0-9_]{3,20})/gi)) push(m[1]);
  // fallback: kata pertama pesan kalau valid
  const first = msg.trim().split(/\s+/)[0];
  if (first) push(first);
  return out;
}

import type { Config } from "../config";

export interface RobloxUser { id: number; name: string; displayName: string }

/** POST https://users.roblox.com/v1/usernames/users — tanpa API key. */
export function makeRobloxResolver(cfg: Config) {
  return async (username: string): Promise<RobloxUser | null> => {
    const res = await fetch(`${cfg.robloxUsersApi}/v1/usernames/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`roblox users api ${res.status}`);
    const data = (await res.json()) as { data?: { id: number; name: string; displayName: string }[] };
    const u = data.data?.[0];
    return u ? { id: u.id, name: u.name, displayName: u.displayName } : null;
  };
}

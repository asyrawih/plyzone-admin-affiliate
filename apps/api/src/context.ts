import { Analytics } from "@klsm/analytics";
import { migrate, openDb, waitForDb, type Db } from "@klsm/db";
import type { Config } from "./config";

export interface AppContext {
  db: Db;
  analytics: Analytics;
  config: Config;
  /** Resolver username -> user id; bisa di-mock di test. */
  resolveUsername: (username: string) => Promise<{ id: number; name: string; displayName: string } | null>;
  close: () => Promise<void>;
}

export async function createContext(cfg: Config, overrides: Partial<AppContext> = {}): Promise<AppContext> {
  const db = openDb(cfg.databaseUrl, { max: cfg.dbPoolMax });
  // Setelah reboot node, Postgres bisa naik belakangan; tunggu, jangan crash-loop.
  await waitForDb(db, { log: (m) => console.warn(m) });
  const ran = await migrate(db);
  if (ran.length) console.log(`[db] migrasi dijalankan: ${ran.join(", ")}`);
  const analytics = await Analytics.open({ databaseUrl: cfg.databaseUrl, tz: cfg.tz, extensionDir: cfg.duckdbExtensionDir });
  return {
    db, analytics, config: cfg,
    resolveUsername: overrides.resolveUsername ?? (await import("./services/roblox")).makeRobloxResolver(cfg),
    close: async () => { await analytics.close(); await db.end(); },
    ...overrides,
  };
}

export type Vars = { ctx: AppContext; userId?: number; mapId?: number };

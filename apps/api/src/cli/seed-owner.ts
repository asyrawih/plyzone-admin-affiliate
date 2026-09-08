import { migrate, openDb, users, rates, waitForDb } from "@klsm/db";
import { config } from "../config";
import { hashPassword } from "../services/password";

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error("pakai: bun run seed:owner <username> <password>");
  process.exit(1);
}
const db = openDb(config.databaseUrl, { max: 1 });
await waitForDb(db, { attempts: 5, delayMs: 1000, log: console.warn });
await migrate(db);
const existing = await users.findByUsername(db, username);
if (existing) {
  await users.updatePassword(db, existing.id, await hashPassword(password));
  console.log(`password owner '${username}' diperbarui`);
} else {
  await users.create(db, username, await hashPassword(password));
  console.log(`owner '${username}' dibuat`);
}
if (!(await rates.current(db))) {
  await rates.create(db, { commissionBps: 1000, robloxFeeBps: 3000, idrPerRobux: 145, minPayoutIdr: 0, effectiveFrom: "2000-01-01T00:00:00.000Z" });
  console.log("rate default dibuat: komisi 10%, fee roblox 30%, 145 IDR/Robux. Ubah di Config.");
}
await db.end();

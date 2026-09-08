import { migrate, openDb, waitForDb } from "@klsm/db";
import { config } from "../config";
const db = openDb(config.databaseUrl, { max: 1 });
await waitForDb(db, { attempts: 5, delayMs: 1000, log: console.warn });
const ran = await migrate(db);
console.log(ran.length ? `migrasi: ${ran.join(", ")}` : "tidak ada migrasi baru");
await db.end();

import { SQL } from "bun";
import { openDb, type Db } from "./connection";
import { migrate } from "./migrate";

/**
 * Database sekali pakai untuk test. Butuh Postgres yang bisa CREATE DATABASE:
 *   TEST_DATABASE_URL=postgres://klsm:klsm@localhost:5433/klsm   (docker compose service `postgres`)
 * Tiap pemanggil dapat database baru `klsm_test_<acak>` yang sudah dimigrasi, plus URL-nya
 * (dipakai DuckDB untuk ATTACH). `drop()` menutup pool dan menghapus database.
 */
export async function createTestDb(): Promise<{ db: Db; url: string; drop: () => Promise<void> }> {
  const base = process.env.TEST_DATABASE_URL ?? "postgres://klsm:klsm@localhost:5433/klsm";
  const name = `klsm_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new SQL(base, { max: 1 });
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  const url = new URL(base);
  url.pathname = `/${name}`;
  const db = openDb(url.toString(), { max: 4 });
  await migrate(db);
  return {
    db,
    url: url.toString(),
    drop: async () => {
      await db.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    },
  };
}

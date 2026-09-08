import { config } from "./config";
import { createContext } from "./context";
import { createApp } from "./app";

const ctx = await createContext(config);
const app = createApp(ctx, { log: true });

const dbHost = (() => { try { return new URL(config.databaseUrl).host; } catch { return "?"; } })();
console.log(`[api] listening on :${config.port}  postgres=${dbHost}  duckdb=:memory: (attach postgres)`);
export default { port: config.port, fetch: app.fetch };

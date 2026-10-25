import { buildApp } from "./app.js";
import { purgeExpiredSessions } from "./auth/sessions.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";

const config = loadConfig();
if (config.production && !config.cookieSecure) {
  console.warn("WARNING: running in production without COOKIE_SECURE=true. Serve over HTTPS and set it.");
}
const db = createDb(config.databaseUrl);
const app = await buildApp(db, { sessionTtlHours: config.sessionTtlHours, cookieSecure: config.cookieSecure, logger: true, serveWeb: config.production });
setInterval(() => void purgeExpiredSessions(db).catch(() => undefined), 3_600_000).unref();
await app.listen({ port: config.port, host: config.production ? "0.0.0.0" : "127.0.0.1" });

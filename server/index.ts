import { buildApp } from "./app.js";
import { purgeExpiredSessions } from "./auth/sessions.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";

const config = loadConfig();
if (config.production && !config.cookieSecure) {
  console.warn("WARNING: running in production without HTTPS. Set TLS_PFX_FILE (or TLS_CERT_FILE/TLS_KEY_FILE), or COOKIE_SECURE=true behind an HTTPS proxy.");
}
const db = createDb(config.databaseUrl);
const app = await buildApp(db, {
  sessionTtlHours: config.sessionTtlHours, cookieSecure: config.cookieSecure, logger: true, serveWeb: config.production,
  webDir: config.webDir, https: config.https ?? undefined,
});
setInterval(() => void purgeExpiredSessions(db).catch(() => undefined), 3_600_000).unref();
await app.listen({ port: config.port, host: config.host });

// Offline desktop demo: one program with an embedded database, the API and the web app.
// Built into a Windows zip by `npm run build:offline`. It always loads the SYNTHETIC demo data and
// only listens on this computer (127.0.0.1), so it is a demo, not a way to run EDGE's real data.
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { purgeExpiredSessions } from "./auth/sessions.js";
import { createPgliteDb, runPgliteMigrations } from "./db/pglite.js";
import { DEMO_PASSWORD, demoSeed } from "./db/seed.js";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.EDGE_DATA_DIR ?? path.resolve(appDir, "../data");
const firstRun = !existsSync(path.join(dataDir, "PG_VERSION"));

console.log("EDGE SCM - offline demo (all data is invented)\n");
if (firstRun) console.log("First start: setting up the demo database. This takes a minute or two...");
mkdirSync(dataDir, { recursive: true });

const db = await createPgliteDb(dataDir);
await runPgliteMigrations(db, path.join(appDir, "migrations"));
await demoSeed(db);

const app = await buildApp(db, {
  sessionTtlHours: 12,
  cookieSecure: false,
  serveWeb: true,
  webDir: path.join(appDir, "web"),
});
setInterval(() => void purgeExpiredSessions(db).catch(() => undefined), 3_600_000).unref();

let url = "";
for (let port = Number(process.env.PORT ?? 5173); !url; port++) {
  try {
    url = await app.listen({ port, host: "127.0.0.1" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE" || port > 5190) throw e;
  }
}
url = url.replace("127.0.0.1", "localhost");

console.log(`
Ready. Open ${url} in your browser.

Sign in with any of these (password for all: ${DEMO_PASSWORD})
  engineer.marina@demo.edge.test   site engineer
  pm.marina@demo.edge.test         project manager
  procurement@demo.edge.test       procurement officer
  stores@demo.edge.test            storekeeper
  ops@demo.edge.test               operations manager
  director@demo.edge.test          director

Keep this window open while you use the app. Close it to stop.
Your changes are saved in the "data" folder. Delete that folder to start again from scratch.
`);

if (!process.env.EDGE_NO_BROWSER) openBrowser(url);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await app.close().catch(() => undefined);
  await db.close().catch(() => undefined);
  process.exit(0);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) process.on(sig, () => void stop());

function openBrowser(target: string) {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", target]]
    : process.platform === "darwin" ? ["open", [target]]
    : ["xdg-open", [target]];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).on("error", () => undefined).unref();
  } catch {
    // The address is printed above; the user can open it by hand.
  }
}

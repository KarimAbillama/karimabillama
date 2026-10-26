// Builds the package for EDGE's own Windows Server (PostgreSQL + Windows service + HTTPS + backups):
//   npm run build:server            -> dist/EDGE-SCM-Server-Windows.zip
//   npm run build:server -- linux   -> dist/server-linux/ (same program with the system `node`; for testing)
// See deploy/windows/README-SERVER.txt for what the package contains and how IT installs it.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const target = process.argv[2] === "linux" ? "linux" : "win";
const NODE_VERSION = "22.23.3";
const NODE_WINDOWS_VERSION = "1.0.0-beta.8"; // ships WinSW 1.17 (MIT), used to run the Windows service
const root = process.cwd();
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const outName = target === "win" ? "EDGE-SCM-Server" : "server-linux";
const out = path.join(root, "dist", outName);
const app = path.join(out, "app");
const run = (cmd: string, args: string[], cwd = root) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
const crlf = (s: string) => s.replace(/\r?\n/g, "\r\n");

rmSync(out, { recursive: true, force: true });
mkdirSync(app, { recursive: true });

// 1. Web app
run("npx", ["vite", "build"]);
cpSync(path.join(root, "dist/web"), path.join(app, "web"), { recursive: true });

// 2. Server and management tool, each bundled into one file. Separate small entry files keep the
//    "run directly" guards in migrate.ts and seed.ts inactive.
const externals = ["@node-rs/argon2", "pg-native"];
const banner = [
  'import { createRequire as __cr } from "node:module";',
  'import { fileURLToPath as __fu } from "node:url";',
  'import __p from "node:path";',
  "const require = __cr(import.meta.url);",
  "const __filename = __fu(import.meta.url);",
  "const __dirname = __p.dirname(__filename);",
].join("\n");
for (const [entry, file] of [["server/index.ts", "server.mjs"], ["server/cli.ts", "cli.mjs"]]) {
  await build({
    entryPoints: [path.join(root, entry)], outfile: path.join(app, file), bundle: true, platform: "node", format: "esm", target: "node22",
    external: externals, banner: { js: banner }, logLevel: "warning",
  });
}
writeFileSync(path.join(app, "start-server.mjs"), 'import "./server.mjs";\n');
writeFileSync(path.join(app, "edge-cli.mjs"), 'import "./cli.mjs";\n');
cpSync(path.join(root, "server/db/migrations"), path.join(app, "migrations"), { recursive: true });

// 3. The password-hashing package with the native binary for the target platform
const argon = "@node-rs/argon2";
writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "edge-scm-server", private: true, type: "module", dependencies: { [argon]: pkg.dependencies[argon].replace(/^\^/, "") } }, null, 2));
run("npm", ["install", "--omit=dev", "--no-package-lock", "--no-audit", "--no-fund", ...(target === "win" ? ["--os=win32", "--cpu=x64"] : [])], app);

// 4. Templates for loading EDGE's own data
cpSync(path.join(root, "deploy/templates"), path.join(out, "templates"), { recursive: true });
mkdirSync(path.join(out, "tools"));
cpSync(path.join(root, "scripts/verify-restore.sql"), path.join(out, "tools/verify-restore.sql"));

if (target === "win") {
  // 5. Windows runtime: node.exe and the service wrapper
  const tmp = path.join(root, "dist", "server-tmp");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  run("npm", ["pack", `node-win-x64@${NODE_VERSION}`, `node-windows@${NODE_WINDOWS_VERSION}`, "--silent"], tmp);
  for (const f of readdirSync(tmp).filter((x) => x.endsWith(".tgz"))) {
    const dir = path.join(tmp, f.replace(/\.tgz$/, ""));
    mkdirSync(dir);
    run("tar", ["xzf", path.join(tmp, f), "-C", dir]);
  }
  mkdirSync(path.join(out, "node"));
  cpSync(path.join(tmp, `node-win-x64-${NODE_VERSION}/package/bin/node.exe`), path.join(out, "node/node.exe"));
  const winsw = path.join(tmp, `node-windows-${NODE_WINDOWS_VERSION}/package/bin/winsw`);
  cpSync(path.join(winsw, "winsw.exe"), path.join(out, "tools/winsw.exe"));
  cpSync(path.join(winsw, "winsw.exe.config"), path.join(out, "tools/winsw.exe.config"));
  rmSync(tmp, { recursive: true, force: true });

  // 6. Install, backup and management scripts (Windows line endings)
  for (const f of readdirSync(path.join(root, "deploy/windows"))) {
    writeFileSync(path.join(out, f), crlf(readFileSync(path.join(root, "deploy/windows", f), "utf8")));
  }
  writeFileSync(path.join(out, "THIRD-PARTY.txt"), crlf(`Third-party software in this package (all free, no licence fees):
- Node.js ${NODE_VERSION} (node\\node.exe), MIT licence - https://nodejs.org
- WinSW 1.17 (tools\\winsw.exe, from the node-windows ${NODE_WINDOWS_VERSION} package), MIT licence - https://github.com/winsw/winsw
- JavaScript libraries bundled into app\\*.mjs: see docs/THIRD_PARTY.md in the source repository.
PostgreSQL is installed separately from postgresql.org (PostgreSQL licence).
`));

  const zip = path.join(root, "dist", "EDGE-SCM-Server-Windows.zip");
  rmSync(zip, { force: true });
  run("zip", ["-qr", "-9", zip, outName], path.join(root, "dist"));
  console.log(`\nBuilt ${zip}`);
} else {
  writeFileSync(path.join(out, "edge.sh"), '#!/bin/sh\ncd "$(dirname "$0")"\nexec node --env-file=config/edge.env app/edge-cli.mjs "$@"\n', { mode: 0o755 });
  writeFileSync(path.join(out, "start.sh"), '#!/bin/sh\ncd "$(dirname "$0")"\nexec node --env-file=config/edge.env app/start-server.mjs\n', { mode: 0o755 });
  console.log(`\nBuilt ${out}. Put settings in config/edge.env, then ./edge.sh migrate and ./start.sh`);
}

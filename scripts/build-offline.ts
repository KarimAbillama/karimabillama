// Builds the offline demo as a folder and zip: no installs, no internet, no database server.
//   npm run build:offline            -> dist/EDGE-SCM-Offline-Windows.zip (includes node.exe)
//   npm run build:offline -- linux   -> dist/offline-linux/ (uses the system `node`; for testing)
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const target = process.argv[2] === "linux" ? "linux" : "win";
const NODE_VERSION = "22.23.3";
const root = process.cwd();
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const outName = target === "win" ? "EDGE-SCM-Offline" : "offline-linux";
const out = path.join(root, "dist", outName);
const app = path.join(out, "app");

const run = (cmd: string, args: string[], cwd = root) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
const crlf = (s: string) => s.replace(/\r?\n/g, "\r\n");

rmSync(out, { recursive: true, force: true });
mkdirSync(app, { recursive: true });

// 1. Web app
run("npx", ["vite", "build"]);
cpSync(path.join(root, "dist/web"), path.join(app, "web"), { recursive: true });

// 2. Server in one file. The embedded database (WebAssembly files) and the password hasher
//    (native binary per platform) stay as packages next to it.
const externals = ["@electric-sql/pglite", "@node-rs/argon2"];
await build({
  entryPoints: [path.join(root, "server/offline.ts")],
  outfile: path.join(app, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: externals,
  banner: {
    js: [
      'import { createRequire as __cr } from "node:module";',
      'import { fileURLToPath as __fu } from "node:url";',
      'import __p from "node:path";',
      "const require = __cr(import.meta.url);",
      "const __filename = __fu(import.meta.url);",
      "const __dirname = __p.dirname(__filename);",
    ].join("\n"),
  },
  logLevel: "warning",
});
// A separate entry file, so the "run directly" guards in seed.ts and migrate.ts stay inactive.
writeFileSync(path.join(app, "start.mjs"), 'import "./server.mjs";\n');
cpSync(path.join(root, "server/db/migrations"), path.join(app, "migrations"), { recursive: true });

// 3. The two external packages, with the binaries for the target platform
const deps = Object.fromEntries(externals.map((d) => [d, pkg.dependencies[d].replace(/^\^/, "")]));
writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "edge-scm-offline", private: true, type: "module", dependencies: deps }, null, 2));
const platformFlags = target === "win" ? ["--os=win32", "--cpu=x64"] : [];
run("npm", ["install", "--omit=dev", "--no-package-lock", "--no-audit", "--no-fund", ...platformFlags], app);

// 4. Launcher
if (target === "win") {
  const tmp = path.join(root, "dist", "node-win");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  run("npm", ["pack", `node-win-x64@${NODE_VERSION}`, "--silent"], tmp);
  run("tar", ["xzf", `node-win-x64-${NODE_VERSION}.tgz`], tmp);
  mkdirSync(path.join(out, "node"));
  cpSync(path.join(tmp, "package/bin/node.exe"), path.join(out, "node/node.exe"));
  rmSync(tmp, { recursive: true, force: true });

  writeFileSync(path.join(out, "Start EDGE SCM.bat"), crlf(`@echo off
title EDGE SCM (offline demo) - keep this window open
cd /d "%~dp0"
if not exist "%~dp0node\\node.exe" (
  echo This folder is not unzipped yet. Right-click the zip file, choose "Extract All",
  echo then open the extracted folder and double-click "Start EDGE SCM" again.
  pause
  exit /b 1
)
"%~dp0node\\node.exe" "%~dp0app\\start.mjs"
echo.
echo EDGE SCM has stopped. If you see an error above, send a screenshot of this window.
pause
`));
} else {
  writeFileSync(path.join(out, "start.sh"), '#!/bin/sh\ncd "$(dirname "$0")"\nexec node app/start.mjs\n', { mode: 0o755 });
}

writeFileSync(path.join(out, "READ ME FIRST.txt"), crlf(`EDGE SCM - offline demo
=======================

This is a demo of the EDGE SCM construction app that runs on this computer only.
It does not need the internet and does not install anything.
All companies, people, projects and amounts in it are invented.

TO START
1. Make sure this folder is unzipped (right-click the zip > Extract All).
2. Double-click "Start EDGE SCM".
   If Windows says "Windows protected your PC", click "More info" then "Run anyway".
3. A black window opens. The first start takes a minute or two.
   Your browser then opens at http://localhost:5173
   (if it does not, type that address in Chrome or Edge yourself).
4. Sign in. The password for every demo user is:  Demo@2026!

   engineer.marina@demo.edge.test   site engineer: raise a material request, receive a delivery
   pm.marina@demo.edge.test         project manager: approve requests and orders, project report
   procurement@demo.edge.test       procurement: "Order shortage" from an approved request
   stores@demo.edge.test            storekeeper: issue stock, transfers
   ops@demo.edge.test               operations manager: second approval on larger orders
   director@demo.edge.test          director: third approval, company-wide view

TO STOP
Close the black window.

TO START AGAIN FROM SCRATCH
Stop the app, delete the "data" folder, and start it again.

Do not put real EDGE data in this demo. It has no backups and is not secured for real use.
`));

// 5. Zip
if (target === "win") {
  const zip = path.join(root, "dist", "EDGE-SCM-Offline-Windows.zip");
  rmSync(zip, { force: true });
  run("zip", ["-qr", "-9", zip, outName], path.join(root, "dist"));
  console.log(`\nBuilt ${zip}`);
} else {
  console.log(`\nBuilt ${out}. Start it with ${path.join(out, "start.sh")}`);
}

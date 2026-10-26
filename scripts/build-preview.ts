// Builds the clickable preview as ONE self-contained HTML file (no server, no other files):
//   npm run build:preview  ->  dist/edge-scm-preview.html
// It runs the real web screens against preview/mockServer.ts. The file is written as page content
// without <html>/<head>/<body>, so it can be published as a claude.ai Artifact or opened in a browser.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, "dist/preview");
execFileSync("npx", ["vite", "build", "--config", "preview/vite.config.ts"], { cwd: root, stdio: "inherit" });

const assets = path.join(out, "assets");
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith(".js")).map((f) => readFileSync(path.join(assets, f), "utf8"));
const css = files.filter((f) => f.endsWith(".css")).map((f) => readFileSync(path.join(assets, f), "utf8"));
if (js.length !== 1) throw new Error(`Expected one script bundle, found ${js.length}`);

const page = [
  "<title>EDGE SCM Preview</title>",
  `<style>${css.join("\n")}</style>`,
  '<div id="root"></div>',
  `<script type="module">${js[0].replace(/<\/script/gi, "<\\/script")}</script>`,
].join("\n");
const file = path.join(root, "dist/edge-scm-preview.html");
writeFileSync(file, page);
console.log(`Built ${file} (${Math.round(page.length / 1024)} KB)`);

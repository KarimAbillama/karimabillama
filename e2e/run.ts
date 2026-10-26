/**
 * End-to-end journey through the real browser UI (Phase 1 vertical slice):
 *   login → authorised project → material request → approval → purchase order → approval →
 *   partial receipt with rejection → stock issue → project report.
 *
 * Uses the TEST database (wiped), the production web build (run `npm run build` first) and
 * Playwright's Chromium (`npx playwright install chromium` once on a new machine).
 * Screenshots are written to docs/screenshots/.
 */
import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { sql } from "drizzle-orm";
import { createDb } from "../server/db/client.js";
import { runMigrations } from "../server/db/migrate.js";
import { demoSeed, DEMO_PASSWORD } from "../server/db/seed.js";
import { buildApp } from "../server/app.js";

const url = process.env.TEST_DATABASE_URL ?? readFileSync(".env", "utf8").match(/^TEST_DATABASE_URL=(.*)$/m)?.[1];
if (!url || !/test/i.test(url)) throw new Error("TEST_DATABASE_URL must point at a database whose name contains 'test'");
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = "docs/screenshots";
mkdirSync(SHOTS, { recursive: true });

const db = createDb(url, 5);
await db.execute(sql`drop schema if exists drizzle cascade`);
await db.execute(sql`drop schema public cascade`);
await db.execute(sql`create schema public`);
await runMigrations(db);
await demoSeed(db);
const app = await buildApp(db, { sessionTtlHours: 1, cookieSecure: false, serveWeb: true, loginRateLimit: 1000 });
await app.listen({ port: PORT, host: "127.0.0.1" });

const browser = await chromium.launch();
let failures = 0;
const step = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; for (const c of browser.contexts()) for (const p of c.pages()) await p.screenshot({ path: `${process.env.E2E_DEBUG_DIR ?? SHOTS}/failure.png`, fullPage: true }).catch(() => undefined); console.error(`  ✗ ${name}\n    ${(e as Error).message.split("\n")[0]}`); throw e; }
};

async function session(email: string, viewport = { width: 1366, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: "en-GB", timezoneId: "Asia/Dubai" });
  const page = await ctx.newPage();
  page.on("dialog", (d) => void d.accept());
  await page.goto(BASE);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator("main h1").first().waitFor();
  return { page, close: () => ctx.close() };
}
/** The input/select inside a form field whose visible label is exactly `label`. */
const field = (page: Page, label: string) => page.locator(`label.field:has(> span:text-is("${label}"))`).locator("input, select, textarea").first();
const selectProject = (page: Page) => page.getByLabel("Project").first().selectOption({ label: "DEMO-101 — Marina Residential Tower — Interior Fit-out (Demo)" });

try {
  let mrUrl = "";
  let poUrl = "";

  await step("site engineer raises and submits a material request", async () => {
    const { page, close } = await session("engineer.marina@demo.edge.test");
    await page.screenshot({ path: `${SHOTS}/01-home-site-engineer.png`, fullPage: true });
    await selectProject(page);
    await page.getByRole("link", { name: "New material request" }).click();
    await page.getByLabel("Purpose / work description").fill("E2E: Level 15 partitions");
    await page.getByLabel("Item", { exact: true }).selectOption({ label: "GYP-BRD-125 — Gypsum board 12.5 mm, 1200×2400, standard (pcs)" });
    await page.getByLabel(/^Qty/).fill("10");
    await page.getByLabel("Cost code").selectOption({ label: "09-210 Gypsum board & partitions" });
    await page.screenshot({ path: `${SHOTS}/02-new-material-request.png`, fullPage: true });
    await page.getByRole("button", { name: "Save & submit for approval" }).click();
    await page.getByText("pending approval").first().waitFor();
    mrUrl = page.url();
    await close();
  });

  await step("project manager approves it from the approvals inbox", async () => {
    const { page, close } = await session("pm.marina@demo.edge.test");
    await page.getByRole("link", { name: "Approvals" }).click();
    await page.getByRole("link", { name: /^MR-/ }).last().click();
    await page.getByRole("button", { name: "Approve" }).click();
    await page.getByText("approved").first().waitFor();
    await close();
  });

  await step("site engineer cannot see supplier prices", async () => {
    const { page, close } = await session("engineer.marina@demo.edge.test");
    await page.getByRole("link", { name: "Purchase orders" }).click();
    await page.getByRole("link", { name: "PO-2026-00001" }).click();
    await page.getByText("Prices are hidden for your role.").waitFor();
    await close();
  });

  await step("procurement orders the shortage and submits the PO", async () => {
    const { page, close } = await session("procurement@demo.edge.test");
    await page.goto(mrUrl);
    await page.getByRole("link", { name: "Order shortage" }).click();
    await field(page, "Supplier").selectOption({ label: "Gulf Building Materials Trading (Demo)" });
    await page.getByLabel("Deliver to").selectOption({ label: "SS-101 — Site store — Marina Tower" });
    await page.getByLabel("Unit price (AED, excl. VAT)").fill("22.50");
    await page.screenshot({ path: `${SHOTS}/03-purchase-order-from-request.png`, fullPage: true });
    await page.getByRole("button", { name: "Save & submit for approval" }).click();
    await page.getByText("pending approval").first().waitFor();
    poUrl = page.url();
    await close();
  });

  await step("project manager approves the PO", async () => {
    const { page, close } = await session("pm.marina@demo.edge.test");
    await page.goto(poUrl);
    await page.getByRole("button", { name: "Approve" }).click();
    await page.getByText(/^approved$/).first().waitFor();
    await close();
  });

  await step("site engineer receives a partial delivery with a rejection (on a phone)", async () => {
    const { page, close } = await session("engineer.marina@demo.edge.test", { width: 390, height: 844 });
    await page.goto(poUrl);
    await page.getByRole("button", { name: "Receive delivery" }).click();
    await page.getByLabel("Supplier delivery note no.").fill("DN-E2E-1");
    await page.getByLabel(/^Delivered/).fill("6");
    await page.getByLabel(/^Rejected/).fill("1");
    await page.getByLabel("Rejection reason").fill("Corner damaged");
    await page.screenshot({ path: `${SHOTS}/04-receive-delivery-phone.png`, fullPage: true });
    await page.getByRole("button", { name: "Post receipt" }).click();
    await page.getByText("partially received").first().waitFor();
    await page.screenshot({ path: `${SHOTS}/05-po-partially-received-phone.png`, fullPage: true });
    await close();
  });

  await step("storekeeper issues the accepted boards to the crew", async () => {
    const { page, close } = await session("stores@demo.edge.test");
    await page.goto(mrUrl);
    await page.getByRole("link", { name: "Issue stock" }).click();
    await page.getByLabel("Issue from").selectOption({ label: "SS-101 — Site store — Marina Tower" });
    await page.getByLabel("Issued to (crew / person)").fill("Drywall crew — E2E");
    await page.getByLabel("Quantity for GYP-BRD-125").fill("5");
    await page.screenshot({ path: `${SHOTS}/06-issue-stock.png`, fullPage: true });
    await page.getByRole("button", { name: "Post issue" }).click();
    await page.waitForURL(/material-requests\//);
    await page.getByRole("cell", { name: "5", exact: true }).first().waitFor();
    await page.screenshot({ path: `${SHOTS}/07-request-coverage.png`, fullPage: true });
    await close();
  });

  await step("project manager reviews the project report with drill-down", async () => {
    const { page, close } = await session("pm.marina@demo.edge.test");
    await page.getByRole("link", { name: "Materials report" }).click();
    await page.getByText("Committed", { exact: true }).first().waitFor();
    await page.getByText("Not tracked yet").first().waitFor();
    await page.getByRole("button", { name: "Show source records" }).first().click();
    await page.getByText(/Source records — Committed/).waitFor();
    await page.screenshot({ path: `${SHOTS}/08-project-report.png`, fullPage: true });
    await close();
  });

  await step("a user from another project cannot open this request by URL", async () => {
    const { page, close } = await session("engineer.villa@demo.edge.test");
    await page.goto(mrUrl);
    await page.getByText("Material request not found").waitFor();
    await close();
  });

  // ───────────── Project control ─────────────
  await step("the director starts on the overview of all projects, worst first", async () => {
    const { page, close } = await session("director@demo.edge.test");
    await page.locator(".totals-strip").waitFor();
    await page.locator(".project-row").nth(2).waitFor();
    if (!(await page.locator(".project-row").first().getAttribute("class"))?.includes("rag-edge-red")) throw new Error("worst project is not first");
    await page.screenshot({ path: `${SHOTS}/10-owner-overview.png`, fullPage: true });
    await close();
  });

  await step("the document controller resubmits the mock-up and records the consultant's approval", async () => {
    const { page, close } = await session("dc@demo.edge.test");
    await page.getByRole("link", { name: "Submittals & mock-ups" }).click();
    await page.getByRole("link", { name: "SUB-2026-00004" }).click();
    await page.getByRole("button", { name: /Resubmit as revision 1/ }).click();
    await field(page, "Transmittal no.").fill("TR-104");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByRole("button", { name: "Record consultant response" }).click();
    await field(page, "Code").selectOption({ label: "B — Approved as noted" });
    await field(page, "Consultant's comments").fill("Setting-out accepted");
    await page.getByRole("button", { name: "Save response" }).click();
    await page.locator("h1 .badge", { hasText: /^approved$/i }).waitFor();
    await page.screenshot({ path: `${SHOTS}/11-submittal-revisions.png`, fullPage: true });
    await close();
  });

  await step("paint cannot be ordered until its material submittal is approved", async () => {
    const { page, close } = await session("procurement@demo.edge.test");
    await page.getByRole("link", { name: "Purchase orders" }).click();
    await page.getByRole("link", { name: "New purchase order" }).click();
    await field(page, "Supplier").selectOption({ label: "Gulf Building Materials Trading (Demo)" });
    await page.getByLabel("Deliver to").selectOption({ label: "SS-101 — Site store — Marina Tower" });
    await page.getByLabel("Item", { exact: true }).selectOption({ label: "PNT-EMU-WHT — Interior emulsion paint, white (l)" });
    await field(page, "Qty").fill("5");
    await page.getByLabel("Unit price (AED, excl. VAT)").fill("120");
    await field(page, "Cost code").selectOption({ label: "09-900 Painting & coatings" });
    await page.getByRole("button", { name: "Save & submit for approval" }).click();
    await page.getByText("Not approved by the consultant yet").waitFor();
    await close();
  });

  await step("the site engineer writes the daily report on a phone and the PM accepts it", async () => {
    const eng = await session("engineer.villa@demo.edge.test", { width: 390, height: 844 });
    await eng.page.getByRole("link", { name: "Write today's report" }).first().click();
    await field(eng.page, "Trade").fill("Landscaper");
    await field(eng.page, "Number").fill("9");
    await field(eng.page, "Work done today").fill("Paving driveway bay 1; irrigation laterals zone A");
    await field(eng.page, "Was work held up?").selectOption({ label: "Yes: Consultant (approval / inspection)" });
    await field(eng.page, "What held the work up (required)").fill("Pool tiling on hold: tile sample still with the consultant");
    await eng.page.screenshot({ path: `${SHOTS}/12-daily-report-phone.png`, fullPage: true });
    await eng.page.getByRole("button", { name: "Submit to project manager" }).click();
    await eng.page.locator("h1 .badge", { hasText: /submitted/i }).waitFor();
    await eng.close();
    const pm = await session("pm.villa@demo.edge.test");
    await pm.page.getByRole("link", { name: /Review the daily report/ }).first().click();
    await pm.page.getByRole("button", { name: "Accept" }).click();
    await pm.page.locator("h1 .badge", { hasText: /reviewed/i }).waitFor();
    await pm.close();
  });

  await step("home dashboard on a phone", async () => {
    const { page, close } = await session("stores@demo.edge.test", { width: 390, height: 844 });
    await page.screenshot({ path: `${SHOTS}/09-home-storekeeper-phone.png`, fullPage: true });
    await close();
  });
} catch {
  // failure already reported by step()
} finally {
  await browser.close();
  await app.close();
  await db.$client.end();
}
console.log(failures ? `\nE2E FAILED (${failures})` : "\nE2E passed");
process.exit(failures ? 1 : 0);

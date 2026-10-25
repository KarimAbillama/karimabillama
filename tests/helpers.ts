import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { createDb, type DB } from "../server/db/client.js";
import { runMigrations } from "../server/db/migrate.js";
import { baseSeed } from "../server/db/baseSeed.js";
import { companies, costCodes, itemUnitConversions, items, locations, projectMembers, projects, roles, sites, userRoles, users } from "../server/db/schema.js";
import { hashPassword } from "../server/auth/sessions.js";
import { loadActor, type Actor } from "../server/auth/actor.js";
import { postOpeningBalance } from "../server/services/inventory.js";
import { decide, myPendingApprovals } from "../server/services/approvals.js";

function testUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  try {
    const line = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("TEST_DATABASE_URL="));
    if (line) return line.slice("TEST_DATABASE_URL=".length).trim();
  } catch { /* no .env */ }
  return "postgres://edge:edge@localhost:5432/edge_test";
}

/** Wipes the TEST database, applies migrations and reference data. Never point this at real data. */
export async function freshDb(): Promise<DB> {
  const url = testUrl();
  if (!/test/i.test(url)) throw new Error(`Refusing to wipe a database whose URL does not contain "test": ${url}`);
  const db = createDb(url, 12);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`drop schema public cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  await baseSeed(db, "Test Org");
  return db;
}

export const PASSWORD = "Test@Password1";

export async function fixtures(db: DB) {
  const pw = await hashPassword(PASSWORD);
  const [client] = await db.insert(companies).values({ code: "CL-T", name: "Test Client", isClient: true }).returning();
  const [supplier] = await db.insert(companies).values({ code: "SUP-T", name: "Test Supplier", isSupplier: true }).returning();
  const [projA] = await db.insert(projects).values({ code: "T-A", name: "Project A", clientCompanyId: client.id, contractValue: "1000000" }).returning();
  const [projB] = await db.insert(projects).values({ code: "T-B", name: "Project B", clientCompanyId: client.id, contractValue: "2000000" }).returning();
  const [siteA] = await db.insert(sites).values({ projectId: projA.id, code: "A1", name: "Site A1" }).returning();
  const [siteB] = await db.insert(sites).values({ projectId: projB.id, code: "B1", name: "Site B1" }).returning();
  const [whA] = await db.insert(locations).values({ code: "WH-A", name: "Warehouse A", type: "warehouse" }).returning();
  const [ssA] = await db.insert(locations).values({ code: "SS-A", name: "Store A", type: "site_store", projectId: projA.id, siteId: siteA.id }).returning();
  const [ssB] = await db.insert(locations).values({ code: "SS-B", name: "Store B", type: "site_store", projectId: projB.id, siteId: siteB.id }).returning();
  const [board] = await db.insert(items).values({ code: "BRD", description: "Board", category: "Drywall", baseUnit: "pcs" }).returning();
  const [tile] = await db.insert(items).values({ code: "TIL", description: "Tile", category: "Tiles", baseUnit: "m2", purchaseUnit: "box" }).returning();
  await db.insert(itemUnitConversions).values({ itemId: tile.id, unitCode: "box", baseUnitsPerUnit: "1.44" });
  const cc = (await db.select().from(costCodes).where(eq(costCodes.code, "09-210")))[0];

  const roleId = async (k: string) => (await db.select().from(roles).where(eq(roles.key, k)))[0].id;
  const mk = async (email: string, roleKeys: string[], projectIds: string[]) => {
    const [u] = await db.insert(users).values({ email, fullName: email.split("@")[0], passwordHash: pw }).returning();
    for (const k of roleKeys) await db.insert(userRoles).values({ userId: u.id, roleId: await roleId(k) });
    for (const p of projectIds) await db.insert(projectMembers).values({ userId: u.id, projectId: p });
    return (await loadActor(db, u.id)) as Actor;
  };
  const actors = {
    engineerA: await mk("engineer.a@test.local", ["site_engineer"], [projA.id]),
    foremanA: await mk("foreman.a@test.local", ["foreman"], [projA.id]),
    pmA: await mk("pm.a@test.local", ["project_manager"], [projA.id]),
    pmA2: await mk("pm.a2@test.local", ["project_manager"], [projA.id]),
    pmB: await mk("pm.b@test.local", ["project_manager"], [projB.id]),
    engineerB: await mk("engineer.b@test.local", ["site_engineer"], [projB.id]),
    proc: await mk("proc@test.local", ["procurement_officer"], []),
    store: await mk("store@test.local", ["storekeeper"], [projA.id, projB.id]),
    storeA: await mk("store.a@test.local", ["storekeeper"], [projA.id]),
    ops: await mk("ops@test.local", ["operations_manager"], []),
    director: await mk("director@test.local", ["director"], []),
    pmAndProc: await mk("pm.proc@test.local", ["project_manager", "procurement_officer"], [projA.id]),
  };
  return { client, supplier, projA, projB, siteA, siteB, whA, ssA, ssB, board, tile, costCodeId: cc.id, actors };
}

export type Fx = Awaited<ReturnType<typeof fixtures>>;

export async function opening(db: DB, fx: Fx, itemId: string, locationId: string, qty: string, cost = "10") {
  await postOpeningBalance(db, fx.actors.ops, { itemId, locationId, qty, unitCost: cost, reference: "OPEN-T", date: "2026-01-01" });
}

/** Approves every pending step of a document using the given approvers in order. */
export async function approve(db: DB, docId: string, ...approvers: Actor[]) {
  for (const a of approvers) {
    const pending = (await myPendingApprovals(db, a)).find((p) => p.docId === docId);
    if (!pending) throw new Error(`No pending approval for ${a.email}`);
    await db.transaction((tx) => decide(tx, a, pending.requestId, "approve", "ok"));
  }
}

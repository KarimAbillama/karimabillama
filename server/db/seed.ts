/**
 * SYNTHETIC DEMO DATA — every name, company, project and figure here is invented.
 * Nothing represents real EDGE contracts, staff, suppliers or financial records.
 * Run with `npm run db:seed` on an empty development database. Refuses to run in production.
 */
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { createDb, type DB } from "./client.js";
import { baseSeed } from "./baseSeed.js";
import {
  companies, costCodes, itemUnitConversions, items, locations, projectMembers, projects, roles, sites, userRoles, users,
} from "./schema.js";
import { hashPassword } from "../auth/sessions.js";
import { loadActor, type Actor } from "../auth/actor.js";
import { businessToday } from "../lib/dates.js";
import { decide } from "../services/approvals.js";
import { cancelMr, createMr, getMr, submitMr } from "../services/materialRequests.js";
import { reserveForLine } from "../services/materialRequests.js";
import { createPo, getPo, receiveGoods, submitPo } from "../services/purchasing.js";
import { dispatchTransfer, issueStock, postOpeningBalance } from "../services/inventory.js";
import { myPendingApprovals } from "../services/approvals.js";

export const DEMO_PASSWORD = "Demo@2026!";

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export async function demoSeed(db: DB) {
  await baseSeed(db, "EDGE SCM Building Contracting — DEMO DATA");
  const [already] = await db.select().from(projects).where(eq(projects.code, "DEMO-101"));
  if (already) {
    console.log("Demo data already present; skipping.");
    return;
  }
  const today = businessToday();
  const pw = await hashPassword(DEMO_PASSWORD);

  // ── Companies (synthetic) ──
  const co = async (code: string, name: string, flags: Partial<typeof companies.$inferInsert>) =>
    (await db.insert(companies).values({ code, name, ...flags }).returning())[0];
  const clientA = await co("CL-DEMO-01", "Marina Heights Developments (Demo Client)", { isClient: true });
  const clientB = await co("CL-DEMO-02", "Palm Grove Private Owner (Demo Client)", { isClient: true });
  const clientC = await co("CL-DEMO-03", "Al Quoz Logistics Park (Demo Client)", { isClient: true });
  await co("CN-DEMO-01", "Atlas Engineering Consultants (Demo)", { isConsultant: true });
  const supGbm = await co("SUP-DEMO-01", "Gulf Building Materials Trading (Demo)", { isSupplier: true, trn: "100000000000001", paymentTerms: "30 days from invoice", phone: "+971 4 000 0001" });
  const supTiles = await co("SUP-DEMO-02", "Emirates Tiles & Ceramics (Demo)", { isSupplier: true, trn: "100000000000002", paymentTerms: "45 days" });
  const supSteel = await co("SUP-DEMO-03", "Desert Steel Supplies (Demo)", { isSupplier: true, trn: "100000000000003", paymentTerms: "Advance 20%, balance 30 days" });
  const supElec = await co("SUP-DEMO-04", "Oasis Electrical Trading (Demo)", { isSupplier: true, paymentTerms: "30 days" });
  const supLand = await co("SUP-DEMO-05", "Green Landscape Supplies (Demo)", { isSupplier: true, paymentTerms: "Cash on delivery" });
  void supSteel; void supElec;

  // ── Projects, sites, stores ──
  const proj = async (code: string, name: string, client: string, extra: Partial<typeof projects.$inferInsert>) =>
    (await db.insert(projects).values({ code, name, clientCompanyId: client, status: "active", ...extra }).returning())[0];
  const p101 = await proj("DEMO-101", "Marina Residential Tower — Interior Fit-out (Demo)", clientA.id, {
    contractRef: "DEMO/CT/101", locationText: "Dubai Marina (fictional plot)", plotNo: "DEMO-PLOT-101", authorityJurisdiction: "To be confirmed per project",
    startDate: addDays(today, -120), plannedEndDate: addDays(today, 240), contractValue: "18500000.00",
  });
  const p102 = await proj("DEMO-102", "Palm Grove Villa — Landscape, Hardscape & Pool (Demo)", clientB.id, {
    contractRef: "DEMO/CT/102", locationText: "Fictional villa community", plotNo: "DEMO-PLOT-102", startDate: addDays(today, -60), plannedEndDate: addDays(today, 150), contractValue: "2750000.00",
  });
  const p103 = await proj("DEMO-103", "Al Quoz Warehouse — MEP Package (Demo)", clientC.id, {
    contractRef: "DEMO/CT/103", locationText: "Al Quoz (fictional)", startDate: addDays(today, -20), plannedEndDate: addDays(today, 200), contractValue: "6200000.00",
  });
  const [s101] = await db.insert(sites).values({ projectId: p101.id, code: "TWR", name: "Tower — Levels 1–30" }).returning();
  const [s102] = await db.insert(sites).values({ projectId: p102.id, code: "VILLA", name: "Villa plot" }).returning();
  const [s103] = await db.insert(sites).values({ projectId: p103.id, code: "WH1", name: "Warehouse building 1" }).returning();
  const loc = async (code: string, name: string, type: "warehouse" | "site_store", projectId?: string, siteId?: string) =>
    (await db.insert(locations).values({ code, name, type, projectId: projectId ?? null, siteId: siteId ?? null }).returning())[0];
  const wh = await loc("WH-CENTRAL", "Central Warehouse — Al Quoz (Demo)", "warehouse");
  const ss101 = await loc("SS-101", "Site store — Marina Tower", "site_store", p101.id, s101.id);
  const ss102 = await loc("SS-102", "Site store — Palm Grove Villa", "site_store", p102.id, s102.id);
  await loc("SS-103", "Site store — Al Quoz Warehouse", "site_store", p103.id, s103.id);

  // ── Users (synthetic people) ──
  const roleId = async (key: string) => (await db.select().from(roles).where(eq(roles.key, key)))[0].id;
  const mkUser = async (email: string, fullName: string, jobTitle: string, roleKeys: string[], projectIds: string[] = []) => {
    const [u] = await db.insert(users).values({ email, fullName, jobTitle, passwordHash: pw }).returning();
    for (const k of roleKeys) await db.insert(userRoles).values({ userId: u.id, roleId: await roleId(k) });
    for (const p of projectIds) await db.insert(projectMembers).values({ userId: u.id, projectId: p });
    return u;
  };
  await mkUser("admin@demo.edge.test", "Demo Administrator", "System administrator", ["admin"]);
  const director = await mkUser("director@demo.edge.test", "Demo Director", "Managing Director", ["director"]);
  const ops = await mkUser("ops@demo.edge.test", "Demo Operations Manager", "Operations Manager", ["operations_manager"]);
  const pmA = await mkUser("pm.marina@demo.edge.test", "Demo PM Marina", "Project Manager", ["project_manager"], [p101.id]);
  const pmB = await mkUser("pm.villa@demo.edge.test", "Demo PM Villa", "Project Manager", ["project_manager"], [p102.id, p103.id]);
  const se = await mkUser("engineer.marina@demo.edge.test", "Demo Site Engineer Marina", "Site Engineer", ["site_engineer"], [p101.id]);
  await mkUser("foreman.marina@demo.edge.test", "Demo Foreman Marina", "Foreman", ["foreman"], [p101.id]);
  const seB = await mkUser("engineer.villa@demo.edge.test", "Demo Site Engineer Villa", "Site Engineer", ["site_engineer"], [p102.id]);
  const proc = await mkUser("procurement@demo.edge.test", "Demo Procurement Officer", "Procurement Officer", ["procurement_officer"]);
  const store = await mkUser("stores@demo.edge.test", "Demo Central Storekeeper", "Storekeeper", ["storekeeper"], [p101.id, p102.id, p103.id]);
  await mkUser("qs@demo.edge.test", "Demo Quantity Surveyor", "Quantity Surveyor", ["quantity_surveyor"], [p101.id, p102.id]);
  await mkUser("accounts@demo.edge.test", "Demo Accountant", "Accountant", ["accountant"]);
  await mkUser("viewer@demo.edge.test", "Demo Management Viewer", "Management", ["management_viewer"]);
  void director;

  // ── Items ──
  const item = async (code: string, description: string, category: string, baseUnit: string, purchaseUnit: string | null, reorderLevel: string | null, conv: [string, string][] = []) => {
    const [it] = await db.insert(items).values({ code, description, category, baseUnit, purchaseUnit, reorderLevel }).returning();
    for (const [unitCode, f] of conv) await db.insert(itemUnitConversions).values({ itemId: it.id, unitCode, baseUnitsPerUnit: f });
    return it;
  };
  const gyp = await item("GYP-BRD-125", "Gypsum board 12.5 mm, 1200×2400, standard", "Drywall", "pcs", "pcs", "50");
  const blk = await item("BLK-HOL-200", "Hollow concrete block 200 mm", "Masonry", "pcs", "pallet", "500", [["pallet", "90"]]);
  const cem = await item("CEM-OPC-50", "Cement OPC, 50 kg bag", "Cement", "bag", "bag", "100", [["kg", "0.02"]]);
  const paint = await item("PNT-EMU-WHT", "Interior emulsion paint, white", "Paint", "l", "drum", "100", [["drum", "18"]]);
  const tile = await item("TIL-PRC-600", "Porcelain floor tile 600×600, matt", "Tiles", "m2", "box", "40", [["box", "1.44"]]);
  const ppr = await item("PPR-PIPE-25", "PPR pipe PN20, 25 mm", "Plumbing", "m", "pcs", "200", [["pcs", "4"]]);
  const cable = await item("CBL-CU-2.5", "Cu cable 2.5 mm² single core", "Electrical", "m", "roll", "500", [["roll", "100"]]);
  const rebar = await item("STL-RBR-12", "Rebar 12 mm, grade 60", "Steel", "kg", "t", "2000");
  const paver = await item("PVR-INT-80", "Interlock paver 80 mm, grey", "Hardscape", "m2", "m2", "50");
  const drip = await item("IRR-DRP-16", "Drip line 16 mm, 30 cm spacing", "Irrigation", "m", "roll", "300", [["roll", "100"]]);
  await item("POL-CHL-GRN", "Pool chlorine granules", "Pool chemicals", "kg", "kg", "25");
  await item("PLY-18-MR", "Plywood 18 mm, moisture resistant", "Timber", "pcs", "pcs", "30");

  const cc = async (code: string) => (await db.select().from(costCodes).where(eq(costCodes.code, code)))[0].id;
  const A = async (u: { id: string }) => (await loadActor(db, u.id)) as Actor;
  const admin = await A({ id: (await db.select().from(users).where(eq(users.email, "admin@demo.edge.test")))[0].id });
  // Opening balances need stock.adjust; use the operations manager for the documented opening load.
  const opsA = await A(ops);
  void admin;

  // ── Opening stock (central warehouse + one site store) ──
  const opening = async (it: { id: string }, l: { id: string }, qty: string, cost: string) =>
    postOpeningBalance(db, opsA, { itemId: it.id, locationId: l.id, qty, unitCost: cost, reference: "OPENING-DEMO", date: addDays(today, -90) });
  await opening(gyp, wh, "40", "21.5000");
  await opening(blk, wh, "1800", "3.1000");
  await opening(cem, wh, "260", "16.7500");
  await opening(paint, wh, "540", "9.8000");
  await opening(tile, wh, "120", "38.0000");
  await opening(ppr, wh, "160", "7.2500");
  await opening(cable, wh, "3500", "1.9500");
  await opening(rebar, wh, "6500", "2.6500");
  await opening(paver, wh, "30", "42.0000");
  await opening(drip, wh, "1200", "1.1500");
  await opening(cem, ss101, "35", "16.7500");

  const seA = await A(se), pmAA = await A(pmA), procA = await A(proc), storeA = await A(store), pmBA = await A(pmB), seBA = await A(seB);
  const approveAll = async (approver: Actor, docId: string) => {
    for (const a of await myPendingApprovals(db, approver)) if (a.docId === docId) await db.transaction((tx) => decide(tx, approver, a.requestId, "approve", "Approved (demo)"));
  };

  // 1) Acceptance scenario 1 as live demo: 100 gypsum boards requested; 40 reserved from warehouse;
  //    PO for 60; delivery of 50 with 5 rejected; 30 issued to the work.
  const mr1 = await createMr(db, seA, {
    projectId: p101.id, siteId: s101.id, requiredDate: addDays(today, 3), purpose: "Level 12 partitions (demo)",
    lines: [{ itemId: gyp.id, qty: "100", costCodeId: await cc("09-210") }, { itemId: cem.id, qty: "20", costCodeId: await cc("04-220") }],
  });
  await submitMr(db, seA, mr1.id);
  await approveAll(pmAA, mr1.id);
  const mr1d = await getMr(db, pmAA, mr1.id);
  await reserveForLine(db, storeA, mr1d.lines[0].id, wh.id, "40");
  await reserveForLine(db, storeA, mr1d.lines[1].id, ss101.id, "20");
  const po1 = await createPo(db, procA, {
    projectId: p101.id, supplierId: supGbm.id, deliveryLocationId: ss101.id, requiredDate: addDays(today, 2), promisedDate: addDays(today, -1),
    paymentTerms: "30 days from invoice", supplierQuoteRef: "Q-DEMO-5512",
    lines: [{ itemId: gyp.id, mrLineId: mr1d.lines[0].id, costCodeId: await cc("09-210"), unitCode: "pcs", qty: "60", unitPrice: "22.0000", vatCode: "SR" }],
  });
  await submitPo(db, procA, po1.id);
  await approveAll(pmAA, po1.id);
  const po1d = await getPo(db, procA, po1.id);
  await receiveGoods(db, seA, po1.id, {
    idempotencyKey: "demo-grn-po1-a", deliveryNoteRef: "DN-DEMO-77812", receivedDate: addDays(today, -1),
    lines: [{ poLineId: po1d.lines[0].id, qtyReceived: "50", qtyRejected: "5", rejectionReason: "Broken edges on delivery" }],
  });
  await issueStock(db, storeA, { idempotencyKey: "demo-iss-1", locationId: ss101.id, issuedTo: "Drywall crew — Demo Foreman", lines: [{ mrLineId: mr1d.lines[0].id, qty: "30" }, { mrLineId: mr1d.lines[1].id, qty: "12" }] });

  // 2) Paint request waiting for PM approval.
  const mr2 = await createMr(db, seA, {
    projectId: p101.id, siteId: s101.id, requiredDate: addDays(today, 7), purpose: "Levels 8–10 first coat (demo)",
    lines: [{ itemId: paint.id, qty: "360", costCodeId: await cc("09-900") }, { itemId: tile.id, qty: "86.4", costCodeId: await cc("09-300") }],
  });
  await submitMr(db, seA, mr2.id);

  // 3) Draft request not yet submitted.
  await createMr(db, seA, { projectId: p101.id, siteId: s101.id, requiredDate: addDays(today, 14), purpose: "Bathroom pipework L14 (draft, demo)", lines: [{ itemId: ppr.id, qty: "240", costCodeId: await cc("22-110") }] });

  // 4) Villa: approved request, PO overdue for delivery, landscaping items.
  const mr4 = await createMr(db, seBA, {
    projectId: p102.id, siteId: s102.id, requiredDate: addDays(today, -2), purpose: "Driveway paving & irrigation (demo)",
    lines: [{ itemId: paver.id, qty: "180", costCodeId: await cc("32-140") }, { itemId: drip.id, qty: "600", costCodeId: await cc("32-840") }],
  });
  await submitMr(db, seBA, mr4.id);
  await approveAll(pmBA, mr4.id);
  const mr4d = await getMr(db, pmBA, mr4.id);
  await reserveForLine(db, storeA, mr4d.lines[0].id, wh.id, "30");
  const po4 = await createPo(db, procA, {
    projectId: p102.id, supplierId: supLand.id, deliveryLocationId: ss102.id, requiredDate: addDays(today, -3), promisedDate: addDays(today, -4),
    lines: [{ itemId: paver.id, mrLineId: mr4d.lines[0].id, costCodeId: await cc("32-140"), unitCode: "m2", qty: "150", unitPrice: "39.5000", vatCode: "SR" }],
  });
  await submitPo(db, procA, po4.id);
  await approveAll(pmBA, po4.id);
  // drip line: transfer from warehouse to villa store, still in transit
  await reserveForLine(db, storeA, mr4d.lines[1].id, wh.id, "600");
  await dispatchTransfer(db, storeA, {
    idempotencyKey: "demo-trf-1", fromLocationId: wh.id, toLocationId: ss102.id, vehicleRef: "Pickup D-DEMO-12", notes: "Demo transfer",
    lines: [{ itemId: drip.id, qty: "600", mrLineId: mr4d.lines[1].id }],
  });

  // 5) A higher-value tile PO that needs two approval levels (PM approved, waiting for Ops Manager).
  const mr5 = await createMr(db, seA, {
    projectId: p101.id, siteId: s101.id, requiredDate: addDays(today, 21), purpose: "Corridor flooring L1–L6 (demo)",
    lines: [{ itemId: tile.id, qty: "1440", costCodeId: await cc("09-300") }],
  });
  await submitMr(db, seA, mr5.id);
  await approveAll(pmAA, mr5.id);
  const mr5d = await getMr(db, pmAA, mr5.id);
  const po5 = await createPo(db, procA, {
    projectId: p101.id, supplierId: supTiles.id, deliveryLocationId: wh.id, requiredDate: addDays(today, 18), promisedDate: addDays(today, 16),
    lines: [{ itemId: tile.id, mrLineId: mr5d.lines[0].id, costCodeId: await cc("09-300"), unitCode: "box", qty: "1000", unitPrice: "52.0000", vatCode: "SR" }],
  });
  await submitPo(db, procA, po5.id);
  await approveAll(pmAA, po5.id);

  // 6) Cancelled request (keeps its number; numbers are never reused).
  const mr6 = await createMr(db, seA, { projectId: p101.id, requiredDate: addDays(today, 5), purpose: "Duplicate entry (demo)", lines: [{ itemId: blk.id, qty: "90", costCodeId: await cc("04-220") }] });
  await cancelMr(db, seA, mr6.id, "Duplicate of another request");

  console.log(`Demo data loaded. All demo users share the password: ${DEMO_PASSWORD}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Demo seed refused: set ALLOW_DEMO_SEED=true in a non-production environment.");
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = createDb(url, 2);
  await demoSeed(db);
  await db.$client.end();
}

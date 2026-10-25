/**
 * Reference data every environment needs (roles, units, cost-code library, transit location,
 * placeholder approval rules). Idempotent: safe to run more than once.
 */
import { eq } from "drizzle-orm";
import type { DB } from "./client.js";
import { approvalRules, costCodes, locations, organizationSettings, rolePermissions, roles, units } from "./schema.js";
import { ROLE_TEMPLATES } from "../auth/roles.js";

export const UNIT_DEFS = [
  { code: "pcs", name: "Pieces", dimension: "count", factorToReference: null },
  { code: "box", name: "Box", dimension: "count", factorToReference: null },
  { code: "bag", name: "Bag", dimension: "count", factorToReference: null },
  { code: "pallet", name: "Pallet", dimension: "count", factorToReference: null },
  { code: "roll", name: "Roll", dimension: "count", factorToReference: null },
  { code: "drum", name: "Drum / pail", dimension: "count", factorToReference: null },
  { code: "mm", name: "Millimetre", dimension: "length", factorToReference: "0.001" },
  { code: "m", name: "Metre", dimension: "length", factorToReference: "1" },
  { code: "m2", name: "Square metre", dimension: "area", factorToReference: "1" },
  { code: "m3", name: "Cubic metre", dimension: "volume", factorToReference: "1" },
  { code: "l", name: "Litre", dimension: "volume", factorToReference: "0.001" },
  { code: "kg", name: "Kilogram", dimension: "mass", factorToReference: "1" },
  { code: "t", name: "Tonne", dimension: "mass", factorToReference: "1000" },
] as const;

/** Sample cost-code library (CSI-style). PROPOSED — replace with EDGE's own codes. */
export const COST_CODE_DEFS = [
  { code: "03-300", name: "Cast-in-place concrete", category: "material" },
  { code: "03-210", name: "Reinforcement steel", category: "material" },
  { code: "04-220", name: "Concrete blockwork", category: "material" },
  { code: "06-100", name: "Rough carpentry / formwork", category: "material" },
  { code: "09-210", name: "Gypsum board & partitions", category: "material" },
  { code: "09-300", name: "Tiling", category: "material" },
  { code: "09-900", name: "Painting & coatings", category: "material" },
  { code: "13-110", name: "Swimming pools", category: "material" },
  { code: "22-110", name: "Plumbing piping", category: "material" },
  { code: "26-050", name: "Electrical cabling", category: "material" },
  { code: "32-140", name: "Hardscape & paving", category: "material" },
  { code: "32-840", name: "Irrigation", category: "material" },
  { code: "32-900", name: "Softscape / planting", category: "material" },
] as const;

export async function baseSeed(db: DB, orgName = "EDGE SCM Building Contracting") {
  await db.insert(organizationSettings).values({ id: 1, legalName: orgName, tradeName: orgName }).onConflictDoNothing();
  await db.insert(units).values(UNIT_DEFS.map((u) => ({ ...u }))).onConflictDoNothing();
  for (const t of ROLE_TEMPLATES) {
    const [existing] = await db.select().from(roles).where(eq(roles.key, t.key));
    const role = existing ?? (await db.insert(roles).values({ key: t.key, name: t.name, description: t.description, allProjects: t.allProjects }).returning())[0];
    await db.insert(rolePermissions).values(t.permissions.map((p) => ({ roleId: role.id, permission: p }))).onConflictDoNothing();
  }
  await db.insert(costCodes).values(COST_CODE_DEFS.map((c) => ({ ...c }))).onConflictDoNothing();
  await db.insert(locations).values({ code: "TRANSIT", name: "Goods in transit (system)", type: "transit" }).onConflictDoNothing();

  const existingRules = await db.select().from(approvalRules);
  if (!existingRules.length) {
    // PLACEHOLDER thresholds (AED, excl. VAT). EDGE must confirm the real delegation of authority.
    await db.insert(approvalRules).values([
      { docType: "material_request", minAmount: "0", maxAmount: null, stepRoleKeys: ["project_manager"], description: "Site material requests: project manager approval (placeholder)" },
      { docType: "purchase_order", minAmount: "0", maxAmount: "25000", stepRoleKeys: ["project_manager"], description: "PO up to AED 25,000: PM (placeholder)" },
      { docType: "purchase_order", minAmount: "25000.01", maxAmount: "100000", stepRoleKeys: ["project_manager", "operations_manager"], description: "PO AED 25,000–100,000: PM then Ops Manager (placeholder)" },
      { docType: "purchase_order", minAmount: "100000.01", maxAmount: null, stepRoleKeys: ["project_manager", "operations_manager", "director"], description: "PO above AED 100,000: PM, Ops Manager, Director (placeholder)" },
    ]);
  }
}

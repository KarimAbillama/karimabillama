/**
 * Loads EDGE's own master data from CSV files (templates in deploy/templates/):
 *   cost_codes, companies, projects, sites, locations, items, users, consultant_codes.
 * Rows are matched on their code (users on email): existing records are updated, new ones created.
 * Everything runs in ONE transaction: if any row is invalid nothing is saved and every problem is
 * listed with its file and row number. New users get a temporary password and must change it.
 */
import { randomInt } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB, Tx } from "../db/client.js";
import {
  companies, costCodes, itemUnitConversions, items, locations, projectMembers, projects, roles, sites, submittalCodes, units, userRoles, users,
} from "../db/schema.js";
import { hashPassword } from "../auth/sessions.js";
import { parseCsv, parseDate } from "../lib/csvRead.js";
import { dec } from "../lib/decimal.js";

export const IMPORT_FILES = ["cost_codes", "companies", "projects", "sites", "locations", "items", "users", "consultant_codes"] as const;
export type ImportFile = (typeof IMPORT_FILES)[number];

export interface ImportResult {
  ok: boolean;
  dryRun: boolean;
  problems: string[];
  counts: Record<string, { created: number; updated: number }>;
  temporaryPasswords: { email: string; fullName: string; password: string }[];
}

class Rollback extends Error {}

const COMPANY_TYPES = ["client", "consultant", "supplier", "subcontractor"];
const OUTCOMES = ["approved", "approved_as_noted", "revise_resubmit", "rejected", "for_information"];
const COST_CATEGORIES = ["material", "labour", "equipment", "subcontract", "overhead"];
const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed", "closed"];

/** Readable temporary password, e.g. "Edge-4821-tulip" (must be changed at first sign-in). */
export function tempPassword() {
  const words = ["palm", "falcon", "dune", "pearl", "tulip", "cedar", "harbor", "oasis", "amber", "coral", "jasmine", "marina"];
  return `Edge-${randomInt(1000, 10000)}-${words[randomInt(words.length)]}`;
}

export async function importMasters(db: DB, files: Partial<Record<ImportFile, string>>, opts: { dryRun?: boolean } = {}): Promise<ImportResult> {
  const result: ImportResult = { ok: false, dryRun: !!opts.dryRun, problems: [], counts: {}, temporaryPasswords: [] };
  const rows = Object.fromEntries(Object.entries(files).map(([k, text]) => [k, parseCsv(text!)])) as Partial<Record<ImportFile, Record<string, string>[]>>;
  const problem = (file: string, i: number, msg: string) => result.problems.push(`${file}.csv row ${i + 2}: ${msg}`);
  const need = (file: string, i: number, r: Record<string, string>, ...cols: string[]) => {
    let ok = true;
    for (const c of cols) if (!r[c]) { problem(file, i, `"${c}" is empty`); ok = false; }
    return ok;
  };
  const count = (file: string, created: boolean) => {
    const c = (result.counts[file] ??= { created: 0, updated: 0 });
    if (created) c.created++; else c.updated++;
  };

  try {
    await db.transaction(async (tx: Tx) => {
      const projectId = async (code: string) => (await tx.select({ id: projects.id }).from(projects).where(eq(projects.code, code)))[0]?.id;
      const companyId = async (code: string) => (await tx.select({ id: companies.id }).from(companies).where(eq(companies.code, code)))[0]?.id;
      const unitCodes = new Set((await tx.select({ code: units.code }).from(units)).map((u) => u.code));

      for (const [i, r] of (rows.cost_codes ?? []).entries()) {
        if (!need("cost_codes", i, r, "code", "name")) continue;
        const category = (r.category || "material").toLowerCase();
        if (!COST_CATEGORIES.includes(category)) { problem("cost_codes", i, `category must be one of ${COST_CATEGORIES.join(", ")}`); continue; }
        const [old] = await tx.select().from(costCodes).where(eq(costCodes.code, r.code));
        if (old) await tx.update(costCodes).set({ name: r.name, category: category as "material" }).where(eq(costCodes.id, old.id));
        else await tx.insert(costCodes).values({ code: r.code, name: r.name, category: category as "material" });
        count("cost_codes", !old);
      }

      for (const [i, r] of (rows.companies ?? []).entries()) {
        if (!need("companies", i, r, "code", "name", "type")) continue;
        const types = r.type.toLowerCase().split(/[|,;/]/).map((t) => t.trim()).filter(Boolean);
        const bad = types.filter((t) => !COMPANY_TYPES.includes(t));
        if (bad.length) { problem("companies", i, `unknown type "${bad.join(", ")}" (use ${COMPANY_TYPES.join(", ")})`); continue; }
        const v = {
          name: r.name, trn: r.trn || null, phone: r.phone || null, email: r.email || null, paymentTerms: r.payment_terms || null,
          isClient: types.includes("client"), isConsultant: types.includes("consultant"), isSupplier: types.includes("supplier"), isSubcontractor: types.includes("subcontractor"),
        };
        const [old] = await tx.select().from(companies).where(eq(companies.code, r.code));
        if (old) await tx.update(companies).set(v).where(eq(companies.id, old.id));
        else await tx.insert(companies).values({ code: r.code, ...v });
        count("companies", !old);
      }

      for (const [i, r] of (rows.projects ?? []).entries()) {
        if (!need("projects", i, r, "code", "name")) continue;
        const status = (r.status || "active").toLowerCase();
        if (!PROJECT_STATUSES.includes(status)) { problem("projects", i, `status must be one of ${PROJECT_STATUSES.join(", ")}`); continue; }
        const client = r.client_code ? await companyId(r.client_code) : null;
        const consultant = r.consultant_code ? await companyId(r.consultant_code) : null;
        if (r.client_code && !client) { problem("projects", i, `client_code "${r.client_code}" is not in companies`); continue; }
        if (r.consultant_code && !consultant) { problem("projects", i, `consultant_code "${r.consultant_code}" is not in companies`); continue; }
        const start = r.start_date ? parseDate(r.start_date) : null;
        const end = r.planned_end_date ? parseDate(r.planned_end_date) : null;
        if ((r.start_date && !start) || (r.planned_end_date && !end)) { problem("projects", i, "dates must look like 2026-10-31 or 31/10/2026"); continue; }
        const value = r.contract_value ? r.contract_value.replace(/[, ]/g, "") : null;
        if (value && !/^\d+(\.\d{1,2})?$/.test(value)) { problem("projects", i, "contract_value must be a number"); continue; }
        const days = (v: string, col: string) => {
          if (!v) return undefined;
          const n = Number(v);
          if (!Number.isInteger(n) || n < 1 || n > 90) { problem("projects", i, `${col} must be a whole number from 1 to 90`); return null; }
          return n;
        };
        const sDays = days(r.submittal_review_days, "submittal_review_days"), rDays = days(r.rfi_response_days, "rfi_response_days");
        if (sDays === null || rDays === null) continue;
        const v = {
          name: r.name, clientCompanyId: client, consultantCompanyId: consultant, status: status as "active", startDate: start, plannedEndDate: end, contractValue: value,
          locationText: r.location || null, plotNo: r.plot_no || null, contractRef: r.contract_ref || null,
          ...(sDays ? { submittalReviewDays: sDays } : {}), ...(rDays ? { rfiResponseDays: rDays } : {}),
        };
        const [old] = await tx.select().from(projects).where(eq(projects.code, r.code));
        if (old) await tx.update(projects).set(v).where(eq(projects.id, old.id));
        else await tx.insert(projects).values({ code: r.code, ...v });
        count("projects", !old);
      }

      for (const [i, r] of (rows.sites ?? []).entries()) {
        if (!need("sites", i, r, "project_code", "code", "name")) continue;
        const pid = await projectId(r.project_code);
        if (!pid) { problem("sites", i, `project_code "${r.project_code}" is not in projects`); continue; }
        const [old] = await tx.select().from(sites).where(and(eq(sites.projectId, pid), eq(sites.code, r.code)));
        if (old) await tx.update(sites).set({ name: r.name }).where(eq(sites.id, old.id));
        else await tx.insert(sites).values({ projectId: pid, code: r.code, name: r.name });
        count("sites", !old);
      }

      for (const [i, r] of (rows.locations ?? []).entries()) {
        if (!need("locations", i, r, "code", "name", "type")) continue;
        const type = r.type.toLowerCase();
        if (type !== "warehouse" && type !== "site_store") { problem("locations", i, 'type must be "warehouse" or "site_store"'); continue; }
        const pid = r.project_code ? await projectId(r.project_code) : null;
        if (type === "site_store" && !pid) { problem("locations", i, "a site_store needs a valid project_code"); continue; }
        const [old] = await tx.select().from(locations).where(eq(locations.code, r.code));
        if (old) await tx.update(locations).set({ name: r.name, type, projectId: pid }).where(eq(locations.id, old.id));
        else await tx.insert(locations).values({ code: r.code, name: r.name, type, projectId: pid });
        count("locations", !old);
      }

      for (const [i, r] of (rows.items ?? []).entries()) {
        if (!need("items", i, r, "code", "description", "base_unit")) continue;
        if (!unitCodes.has(r.base_unit)) { problem("items", i, `base_unit "${r.base_unit}" is not a known unit (${[...unitCodes].join(", ")})`); continue; }
        if (r.purchase_unit && !unitCodes.has(r.purchase_unit)) { problem("items", i, `purchase_unit "${r.purchase_unit}" is not a known unit`); continue; }
        const conv: { unitCode: string; factor: string }[] = [];
        let convOk = true;
        for (const part of (r.conversions || "").split(/[|;]/).map((x) => x.trim()).filter(Boolean)) {
          const m = /^([\w.-]+)\s*=\s*(\d+(\.\d+)?)$/.exec(part);
          if (!m || !unitCodes.has(m[1]) || dec(m[2]).lte(0)) { problem("items", i, `conversion "${part}" must look like box=1.44 with a known unit`); convOk = false; continue; }
          conv.push({ unitCode: m[1], factor: m[2] });
        }
        if (!convOk) continue;
        const reorder = r.reorder_level ? r.reorder_level.replace(/,/g, "") : null;
        if (reorder && !/^\d+(\.\d+)?$/.test(reorder)) { problem("items", i, "reorder_level must be a number"); continue; }
        const v = { description: r.description, category: r.category || "General", baseUnit: r.base_unit, purchaseUnit: r.purchase_unit || null, reorderLevel: reorder };
        const [old] = await tx.select().from(items).where(eq(items.code, r.code));
        const id = old ? old.id : (await tx.insert(items).values({ code: r.code, ...v }).returning())[0].id;
        if (old) await tx.update(items).set(v).where(eq(items.id, id));
        for (const c of conv) {
          await tx.insert(itemUnitConversions).values({ itemId: id, unitCode: c.unitCode, baseUnitsPerUnit: c.factor })
            .onConflictDoUpdate({ target: [itemUnitConversions.itemId, itemUnitConversions.unitCode], set: { baseUnitsPerUnit: c.factor } });
        }
        count("items", !old);
      }

      const roleRows = await tx.select().from(roles);
      for (const [i, r] of (rows.users ?? []).entries()) {
        if (!need("users", i, r, "email", "full_name", "roles")) continue;
        const email = r.email.toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { problem("users", i, `"${r.email}" is not an email address`); continue; }
        const keys = r.roles.split(/[|,;]/).map((x) => x.trim()).filter(Boolean);
        const unknown = keys.filter((k) => !roleRows.some((ro) => ro.key === k));
        if (unknown.length) { problem("users", i, `unknown role "${unknown.join(", ")}" (use ${roleRows.map((ro) => ro.key).join(", ")})`); continue; }
        const codes = (r.projects || "").split(/[|,;]/).map((x) => x.trim()).filter(Boolean);
        const pids: string[] = [];
        let pOk = true;
        for (const c of codes) { const pid = await projectId(c); if (pid) pids.push(pid); else { problem("users", i, `project "${c}" is not in projects`); pOk = false; } }
        if (!pOk) continue;
        const [old] = await tx.select().from(users).where(eq(users.email, email));
        let id = old?.id;
        if (old) await tx.update(users).set({ fullName: r.full_name, jobTitle: r.job_title || null, isActive: (r.active || "yes").toLowerCase() !== "no" }).where(eq(users.id, old.id));
        else {
          const password = tempPassword();
          id = (await tx.insert(users).values({ email, fullName: r.full_name, jobTitle: r.job_title || null, passwordHash: await hashPassword(password), mustChangePassword: true }).returning())[0].id;
          result.temporaryPasswords.push({ email, fullName: r.full_name, password });
        }
        // Roles and project membership are replaced by what the file says.
        await tx.delete(userRoles).where(eq(userRoles.userId, id!));
        await tx.insert(userRoles).values(keys.map((k) => ({ userId: id!, roleId: roleRows.find((ro) => ro.key === k)!.id })));
        await tx.delete(projectMembers).where(eq(projectMembers.userId, id!));
        if (pids.length) await tx.insert(projectMembers).values(pids.map((projectId) => ({ userId: id!, projectId })));
        count("users", !old);
      }

      for (const [i, r] of (rows.consultant_codes ?? []).entries()) {
        if (!need("consultant_codes", i, r, "project_code", "code", "label", "meaning")) continue;
        const pid = await projectId(r.project_code);
        if (!pid) { problem("consultant_codes", i, `project_code "${r.project_code}" is not in projects`); continue; }
        const outcome = r.meaning.toLowerCase();
        if (!OUTCOMES.includes(outcome)) { problem("consultant_codes", i, `meaning must be one of ${OUTCOMES.join(", ")}`); continue; }
        const [old] = await tx.select().from(submittalCodes).where(and(eq(submittalCodes.projectId, pid), eq(submittalCodes.code, r.code)));
        if (old) await tx.update(submittalCodes).set({ label: r.label, outcome: outcome as "approved" }).where(eq(submittalCodes.id, old.id));
        else await tx.insert(submittalCodes).values({ projectId: pid, code: r.code, label: r.label, outcome: outcome as "approved", sortOrder: i });
        count("consultant_codes", !old);
      }

      if (result.problems.length || opts.dryRun) throw new Rollback();
    });
    result.ok = true;
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
    result.ok = result.problems.length === 0;
    if (opts.dryRun) result.temporaryPasswords = [];
  }
  return result;
}

/** Sets a new temporary password that must be changed at next sign-in. */
export async function resetPassword(db: DB, email: string) {
  const [u] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  if (!u) return null;
  const password = tempPassword();
  await db.update(users).set({ passwordHash: await hashPassword(password), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, u.id));
  return { email: u.email, fullName: u.fullName, password };
}


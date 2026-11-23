/**
 * Contract register, guarantees and insurances, the contract BOQ, measured quantities and cost budgets.
 *
 *  - Contract terms are recorded as written in each contract; nothing is assumed (A-44).
 *  - The BOQ is imported from Excel (CSV). A draft can be re-imported; once confirmed it is frozen by
 *    a database trigger and changes only through variations (next module).
 *  - Site measurements are cumulative quantities to date, kept as history (append-only).
 *  - Contract values, BOQ rates and the value of work done need contract.view; budgets need cost.view.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { DB, DbOrTx } from "../db/client.js";
import { boqLines, boqMeasurements, contractSecurities, contracts, costCodes, projectBudgets, projects, users, type SecurityKind } from "../db/schema.js";
import { type Actor, can, requirePerm, requireProject } from "../auth/actor.js";
import { audit } from "../lib/audit.js";
import { parseBoqCsv } from "../lib/boqParse.js";
import { addDays, businessToday, daysBetween } from "../lib/dates.js";
import { dec, m2, q4, sum } from "../lib/decimal.js";
import { conflict, forbidden, notFound, pgCode, rule } from "../lib/errors.js";
import { drillRows } from "./reports.js";

export const SECURITY_KINDS = ["performance_bond", "advance_payment_guarantee", "retention_bond", "car_insurance", "third_party_insurance", "workmen_compensation", "professional_indemnity", "other"] as const;
/** PROPOSED (A-46): warn this many days before a guarantee or policy expires. */
export const SECURITY_WARN_DAYS = 30;

export interface ContractInput {
  contractNo: string; title?: string | null; form?: string | null; signedDate?: string | null; commencementDate?: string | null; completionDate?: string | null;
  contractValue: string; retentionPct: string; retentionLimitPct?: string | null; advancePct: string; ldPerDay?: string | null; ldCapPct?: string | null;
  defectsLiabilityMonths?: number | null; paymentTermsDays?: number | null; notes?: string | null;
}

async function contractFor(db: DbOrTx, projectId: string) {
  const [c] = await db.select().from(contracts).where(eq(contracts.projectId, projectId));
  return c ?? null;
}

export function securityState(s: { status: string; expiryDate: string }, today = businessToday()) {
  if (s.status === "released") return { state: "released" as const, daysLeft: null };
  const daysLeft = daysBetween(today, s.expiryDate);
  return { state: daysLeft < 0 ? ("expired" as const) : daysLeft <= SECURITY_WARN_DAYS ? ("expiring" as const) : ("valid" as const), daysLeft };
}

function checkPct(label: string, v: string | null | undefined) {
  if (v === null || v === undefined || v === "") return;
  if (dec(v).lt(0) || dec(v).gt(100)) throw rule("INVALID_PCT", `${label} must be between 0 and 100.`);
}

export async function saveContract(db: DB, actor: Actor, projectId: string, input: ContractInput & { version?: number }) {
  requirePerm(actor, "contract.manage");
  requireProject(actor, projectId, "Project");
  if (!input.contractNo.trim()) throw rule("REQUIRED", "Enter the contract number.");
  if (dec(input.contractValue).lt(0)) throw rule("INVALID_VALUE", "The contract value cannot be negative.");
  checkPct("Retention %", input.retentionPct); checkPct("Retention limit %", input.retentionLimitPct); checkPct("Advance payment %", input.advancePct); checkPct("LD cap %", input.ldCapPct);
  if (input.commencementDate && input.completionDate && input.completionDate < input.commencementDate) throw rule("INVALID_DATES", "The completion date is before the commencement date.");
  const values = {
    contractNo: input.contractNo.trim(), title: input.title ?? null, form: input.form ?? null, signedDate: input.signedDate ?? null,
    commencementDate: input.commencementDate ?? null, completionDate: input.completionDate ?? null, contractValue: m2(input.contractValue),
    retentionPct: dec(input.retentionPct).toFixed(2), retentionLimitPct: input.retentionLimitPct ? dec(input.retentionLimitPct).toFixed(2) : null,
    advancePct: dec(input.advancePct).toFixed(2), ldPerDay: input.ldPerDay ? m2(input.ldPerDay) : null, ldCapPct: input.ldCapPct ? dec(input.ldCapPct).toFixed(2) : null,
    defectsLiabilityMonths: input.defectsLiabilityMonths ?? null, paymentTermsDays: input.paymentTermsDays ?? null, notes: input.notes ?? null,
  };
  return db.transaction(async (tx) => {
    const existing = await contractFor(tx, projectId);
    let saved;
    if (!existing) {
      [saved] = await tx.insert(contracts).values({ projectId, ...values, createdBy: actor.userId }).returning();
      await audit(tx, actor, "contract.created", "contract", saved.id, projectId, { contractNo: saved.contractNo, value: saved.contractValue });
    } else {
      if (input.version !== undefined && input.version !== existing.version) throw conflict("Someone else changed this contract. Reload and try again.");
      const changed = Object.entries(values).filter(([k, v]) => String((existing as Record<string, unknown>)[k] ?? "") !== String(v ?? "")).map(([k]) => k);
      [saved] = await tx.update(contracts).set({ ...values, version: existing.version + 1, updatedAt: new Date() }).where(eq(contracts.id, existing.id)).returning();
      await audit(tx, actor, "contract.updated", "contract", saved.id, projectId, { changed });
    }
    // The project card shows the same value, reference and end date as the contract.
    await tx.update(projects).set({ contractValue: saved.contractValue, contractRef: saved.contractNo, ...(saved.completionDate ? { plannedEndDate: saved.completionDate } : {}), ...(saved.commencementDate ? { startDate: saved.commencementDate } : {}) })
      .where(eq(projects.id, projectId));
    return saved;
  });
}

export async function addSecurity(db: DB, actor: Actor, projectId: string, input: {
  kind: SecurityKind; reference: string; issuer?: string | null; amount?: string | null; issueDate?: string | null; expiryDate: string; notes?: string | null;
}) {
  requirePerm(actor, "contract.manage");
  requireProject(actor, projectId, "Project");
  const c = await contractFor(db, projectId);
  if (!c) throw rule("NO_CONTRACT", "Record the contract first.");
  if (!input.reference.trim()) throw rule("REQUIRED", "Enter the guarantee or policy number.");
  if (input.issueDate && input.expiryDate < input.issueDate) throw rule("INVALID_DATES", "The expiry date is before the issue date.");
  return db.transaction(async (tx) => {
    const [s] = await tx.insert(contractSecurities).values({
      contractId: c.id, kind: input.kind, reference: input.reference.trim(), issuer: input.issuer ?? null, amount: input.amount ? m2(input.amount) : null,
      issueDate: input.issueDate ?? null, expiryDate: input.expiryDate, notes: input.notes ?? null, createdBy: actor.userId,
    }).returning();
    await audit(tx, actor, "contract.security_added", "contract", c.id, projectId, { kind: s.kind, reference: s.reference, expiry: s.expiryDate });
    return s;
  });
}

export async function releaseSecurity(db: DB, actor: Actor, securityId: string, input: { releasedDate: string; note?: string | null }) {
  requirePerm(actor, "contract.manage");
  const [row] = await db.select({ s: contractSecurities, projectId: contracts.projectId }).from(contractSecurities)
    .innerJoin(contracts, eq(contracts.id, contractSecurities.contractId)).where(eq(contractSecurities.id, securityId));
  if (!row) throw notFound("Guarantee or policy");
  requireProject(actor, row.projectId, "Guarantee or policy");
  if (row.s.status === "released") throw rule("ALREADY_RELEASED", "This was already released.");
  if (input.releasedDate > businessToday()) throw rule("FUTURE_DATE", "The release date cannot be in the future.");
  return db.transaction(async (tx) => {
    await tx.update(contractSecurities).set({ status: "released", releasedDate: input.releasedDate, notes: input.note ? [row.s.notes, input.note].filter(Boolean).join("\n") : row.s.notes })
      .where(eq(contractSecurities.id, securityId));
    await audit(tx, actor, "contract.security_released", "contract", row.s.contractId, row.projectId, { reference: row.s.reference, releasedDate: input.releasedDate });
  });
}

/** Contract terms, guarantees/insurances and the BOQ summary for one project. */
export async function getContract(db: DbOrTx, actor: Actor, projectId: string) {
  requirePerm(actor, "contract.view");
  requireProject(actor, projectId, "Project");
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) throw notFound("Project");
  const c = await contractFor(db, projectId);
  if (!c) return { project: { id: p.id, code: p.code, name: p.name }, contract: null, securities: [], boq: null };
  const today = businessToday();
  const secs = await db.select().from(contractSecurities).where(eq(contractSecurities.contractId, c.id)).orderBy(asc(contractSecurities.expiryDate));
  const boq = await boqSummary(db, c);
  const [confirmedBy] = c.boqConfirmedBy ? await db.select({ name: users.fullName }).from(users).where(eq(users.id, c.boqConfirmedBy)) : [];
  return {
    project: { id: p.id, code: p.code, name: p.name },
    contract: { ...c, boqConfirmedByName: confirmedBy?.name ?? null, durationDays: c.commencementDate && c.completionDate ? daysBetween(c.commencementDate, c.completionDate) + 1 : null,
      dlpEndDate: c.completionDate && c.defectsLiabilityMonths ? addMonths(c.completionDate, c.defectsLiabilityMonths) : null },
    securities: secs.map((s) => ({ ...s, ...securityState(s, today) })),
    boq,
  };
}

function addMonths(iso: string, months: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

async function latestMeasurements(db: DbOrTx, lineIds: string[]) {
  const m = new Map<string, typeof boqMeasurements.$inferSelect>();
  if (!lineIds.length) return m;
  const rows = await db.select().from(boqMeasurements).where(inArray(boqMeasurements.boqLineId, lineIds)).orderBy(asc(boqMeasurements.asOfDate), asc(boqMeasurements.recordedAt));
  for (const r of rows) m.set(r.boqLineId, r);
  return m;
}

async function boqSummary(db: DbOrTx, c: typeof contracts.$inferSelect) {
  const lines = await db.select().from(boqLines).where(eq(boqLines.contractId, c.id)).orderBy(asc(boqLines.lineNo));
  const priced = lines.filter((l) => l.kind !== "heading");
  const total = sum(priced.map((l) => l.amount!));
  const meas = await latestMeasurements(db, priced.map((l) => l.id));
  const done = sum(priced.filter((l) => l.kind === "item").map((l) => dec(meas.get(l.id)?.qtyToDate ?? 0).times(l.rate!).toDecimalPlaces(2)));
  const sections = new Map<string, { section: string; amount: ReturnType<typeof dec>; done: ReturnType<typeof dec> }>();
  for (const l of priced) {
    const k = l.section ?? "(no heading)";
    const s = sections.get(k) ?? { section: k, amount: dec(0), done: dec(0) };
    s.amount = s.amount.plus(l.amount!);
    if (l.kind === "item") s.done = s.done.plus(dec(meas.get(l.id)?.qtyToDate ?? 0).times(l.rate!).toDecimalPlaces(2));
    sections.set(k, s);
  }
  return {
    status: c.boqStatus, sourceName: c.boqSourceName, lines: lines.length, items: priced.filter((l) => l.kind === "item").length,
    provisionalSums: m2(sum(priced.filter((l) => l.kind === "provisional_sum").map((l) => l.amount!))),
    total: m2(total), difference: m2(total.minus(c.contractValue)), workDone: m2(done), workDonePct: total.isZero() ? "0.0" : done.div(total).times(100).toFixed(1),
    sections: [...sections.values()].map((s) => ({ section: s.section, amount: m2(s.amount), done: m2(s.done) })),
    confirmedAt: c.boqConfirmedAt, confirmNote: c.boqConfirmNote,
  };
}

// ───────────── BOQ import and confirmation ─────────────

export async function importBoq(db: DB, actor: Actor, projectId: string, input: { csv: string; fileName?: string | null; dryRun?: boolean }) {
  requirePerm(actor, "contract.manage");
  requireProject(actor, projectId, "Project");
  const c = await contractFor(db, projectId);
  if (!c) throw rule("NO_CONTRACT", "Record the contract first, then import its BOQ.");
  if (c.boqStatus === "confirmed") throw rule("BOQ_CONFIRMED", "The contract BOQ is already confirmed. Changes now go through variations.");
  const parsed = parseBoqCsv(input.csv);
  const codes = await db.select().from(costCodes);
  const problems = [...parsed.problems];
  for (const l of parsed.lines) if (l.costCode && !codes.some((x) => x.code === l.costCode)) problems.push(`Line ${l.lineNo}${l.ref ? ` (${l.ref})` : ""}: cost code "${l.costCode}" does not exist.`);
  const summary = { lines: parsed.lines.length, items: parsed.lines.filter((l) => l.kind === "item").length, headings: parsed.lines.filter((l) => l.kind === "heading").length,
    provisionalSums: parsed.lines.filter((l) => l.kind === "provisional_sum").length, total: parsed.total, contractValue: c.contractValue, difference: m2(dec(parsed.total).minus(c.contractValue)) };
  if (problems.length) return { ok: false, saved: false, problems, ...summary };
  if (input.dryRun) return { ok: true, saved: false, problems, ...summary, preview: parsed.lines.slice(0, 15) };
  await db.transaction(async (tx) => {
    await tx.delete(boqLines).where(eq(boqLines.contractId, c.id));
    for (let i = 0; i < parsed.lines.length; i += 500) {
      await tx.insert(boqLines).values(parsed.lines.slice(i, i + 500).map((l) => ({
        contractId: c.id, lineNo: l.lineNo, kind: l.kind, ref: l.ref, description: l.description, unit: l.unit, qty: l.qty, rate: l.rate, amount: l.amount,
        costCodeId: l.costCode ? codes.find((x) => x.code === l.costCode)!.id : null, section: l.section,
      })));
    }
    await tx.update(contracts).set({ boqStatus: "draft", boqSourceName: input.fileName ?? null, version: c.version + 1, updatedAt: new Date() }).where(eq(contracts.id, c.id));
    await audit(tx, actor, "boq.imported", "contract", c.id, projectId, { file: input.fileName ?? null, lines: summary.lines, total: summary.total });
  });
  return { ok: true, saved: true, problems, ...summary };
}

export async function confirmBoq(db: DB, actor: Actor, projectId: string, input: { note?: string | null }) {
  requirePerm(actor, "contract.manage");
  requireProject(actor, projectId, "Project");
  const c = await contractFor(db, projectId);
  if (!c || c.boqStatus === "none") throw rule("NO_BOQ", "Import the BOQ first.");
  if (c.boqStatus === "confirmed") throw rule("BOQ_CONFIRMED", "The BOQ is already confirmed.");
  const s = await boqSummary(db, c);
  if (!dec(s.difference).isZero() && !input.note?.trim()) {
    throw rule("BOQ_TOTAL_MISMATCH", `The BOQ total (AED ${s.total}) differs from the contract value (AED ${c.contractValue}) by AED ${s.difference}. Explain the difference (e.g. discount, rounding) to confirm.`);
  }
  await db.transaction(async (tx) => {
    await tx.update(contracts).set({ boqStatus: "confirmed", boqConfirmedAt: new Date(), boqConfirmedBy: actor.userId, boqConfirmNote: input.note?.trim() || null, version: c.version + 1, updatedAt: new Date() })
      .where(eq(contracts.id, c.id));
    await audit(tx, actor, "boq.confirmed", "contract", c.id, projectId, { total: s.total, difference: s.difference, note: input.note ?? null });
  });
  return { ok: true };
}

/** The BOQ with quantities measured to date. Rates and amounts only with contract.view. */
export async function getBoq(db: DbOrTx, actor: Actor, projectId: string) {
  requirePerm(actor, "project.view");
  requireProject(actor, projectId, "Project");
  const c = await contractFor(db, projectId);
  if (!c) return { status: "none" as const, contractNo: null, showRates: can(actor, "contract.view"), lines: [], summary: null };
  const showRates = can(actor, "contract.view");
  const lines = await db.select({ l: boqLines, costCode: costCodes.code }).from(boqLines).leftJoin(costCodes, eq(costCodes.id, boqLines.costCodeId))
    .where(eq(boqLines.contractId, c.id)).orderBy(asc(boqLines.lineNo));
  const meas = await latestMeasurements(db, lines.map((x) => x.l.id));
  const out = lines.map(({ l, costCode }) => {
    const m = meas.get(l.id);
    const qtyToDate = l.kind === "item" ? m?.qtyToDate ?? "0.0000" : null;
    const pct = l.kind === "item" && qtyToDate !== null ? dec(qtyToDate).div(l.qty!).times(100) : null;
    return {
      id: l.id, lineNo: l.lineNo, kind: l.kind, ref: l.ref, description: l.description, unit: l.unit, qty: l.qty, section: l.section, costCode,
      rate: showRates ? l.rate : null, amount: showRates ? l.amount : null,
      qtyToDate, pctDone: pct ? pct.toFixed(1) : null, overMeasured: pct ? pct.gt(100) : false,
      valueDone: showRates && l.kind === "item" ? m2(dec(qtyToDate).times(l.rate!)) : null,
      lastMeasured: m ? { asOfDate: m.asOfDate, remark: m.remark } : null,
    };
  });
  const summary = showRates ? await boqSummary(db, c) : null;
  return { status: c.boqStatus, contractNo: c.contractNo, showRates, lines: out, summary };
}

export async function recordMeasurements(db: DB, actor: Actor, projectId: string, input: { asOfDate: string; rows: { boqLineId: string; qtyToDate: string; remark?: string | null }[] }) {
  requirePerm(actor, "site.progress");
  requireProject(actor, projectId, "Project");
  const c = await contractFor(db, projectId);
  if (!c || c.boqStatus !== "confirmed") throw rule("BOQ_NOT_CONFIRMED", "Quantities can be measured once the contract BOQ is confirmed.");
  if (input.asOfDate > businessToday()) throw rule("FUTURE_DATE", "Measurements cannot be dated in the future.");
  const lines = input.rows.length ? await db.select().from(boqLines).where(and(eq(boqLines.contractId, c.id), inArray(boqLines.id, input.rows.map((r) => r.boqLineId)))) : [];
  const latest = await latestMeasurements(db, lines.map((l) => l.id));
  const problems: string[] = [];
  const warnings: string[] = [];
  const toSave: (typeof boqMeasurements.$inferInsert)[] = [];
  for (const r of input.rows) {
    const l = lines.find((x) => x.id === r.boqLineId);
    if (!l) { problems.push("A line does not belong to this project's BOQ."); continue; }
    const name = l.ref ?? `line ${l.lineNo}`;
    if (l.kind !== "item") { problems.push(`${name}: only measured items take a quantity.`); continue; }
    const q = dec(r.qtyToDate);
    if (q.lt(0)) { problems.push(`${name}: the quantity cannot be negative.`); continue; }
    const prev = latest.get(l.id);
    if (prev && q.eq(prev.qtyToDate)) continue;
    if (prev && input.asOfDate < prev.asOfDate) { problems.push(`${name}: a measurement dated ${prev.asOfDate} already exists; use that date or later.`); continue; }
    if (prev && q.lt(prev.qtyToDate) && !r.remark?.trim()) { problems.push(`${name}: the quantity is lower than last time (${dec(prev.qtyToDate).toString()}). Add a remark explaining the correction.`); continue; }
    if (q.gt(l.qty!)) warnings.push(`${name}: ${q.toString()} ${l.unit} is more than the BOQ quantity (${dec(l.qty!).toString()}). Extra quantity may need a variation or remeasurement.`);
    toSave.push({ boqLineId: l.id, asOfDate: input.asOfDate, qtyToDate: q4(q), remark: r.remark?.trim() || null, recordedBy: actor.userId });
  }
  if (problems.length) return { ok: false, saved: 0, problems, warnings };
  if (toSave.length) {
    await db.transaction(async (tx) => {
      await tx.insert(boqMeasurements).values(toSave);
      await audit(tx, actor, "boq.measured", "contract", c.id, projectId, { asOf: input.asOfDate, lines: toSave.length });
    });
  }
  return { ok: true, saved: toSave.length, problems, warnings };
}

/** Measurement history of one BOQ line. */
export async function measurementHistory(db: DbOrTx, actor: Actor, boqLineId: string) {
  requirePerm(actor, "project.view");
  const [row] = await db.select({ l: boqLines, projectId: contracts.projectId }).from(boqLines).innerJoin(contracts, eq(contracts.id, boqLines.contractId)).where(eq(boqLines.id, boqLineId));
  if (!row) throw notFound("BOQ line");
  requireProject(actor, row.projectId, "BOQ line");
  return db.select({ asOfDate: boqMeasurements.asOfDate, qtyToDate: boqMeasurements.qtyToDate, remark: boqMeasurements.remark, byName: users.fullName, recordedAt: boqMeasurements.recordedAt })
    .from(boqMeasurements).innerJoin(users, eq(users.id, boqMeasurements.recordedBy)).where(eq(boqMeasurements.boqLineId, boqLineId)).orderBy(desc(boqMeasurements.asOfDate), desc(boqMeasurements.recordedAt));
}

// ───────────── Cost budget ─────────────

export async function getBudget(db: DbOrTx, actor: Actor, projectId: string) {
  requirePerm(actor, "cost.view");
  requireProject(actor, projectId, "Project");
  const budgets = await db.select().from(projectBudgets).where(eq(projectBudgets.projectId, projectId));
  const committed = await drillRows(db, projectId, "committed");
  const codes = await db.select().from(costCodes).orderBy(asc(costCodes.code));
  const rows = codes.map((cc) => {
    const b = budgets.find((x) => x.costCodeId === cc.id);
    const com = sum(committed.filter((r) => r.costCodeId === cc.id).map((r) => r.value));
    if (!b && com.isZero()) return null;
    const budget = dec(b?.amount ?? 0);
    return {
      costCodeId: cc.id, costCode: cc.code, name: cc.name, category: cc.category, budget: b ? m2(budget) : null, note: b?.note ?? null, committed: m2(com),
      remaining: b ? m2(budget.minus(com)) : null, usedPct: b && !budget.isZero() ? com.div(budget).times(100).toFixed(1) : null, overBudget: !!b && com.gt(budget),
      noBudget: !b && com.gt(0),
    };
  }).filter((r) => r !== null);
  const totalBudget = sum(rows.map((r) => r.budget ?? 0));
  const totalCommitted = sum(rows.map((r) => r.committed));
  return { rows, totalBudget: m2(totalBudget), totalCommitted: m2(totalCommitted), remaining: m2(totalBudget.minus(totalCommitted)) };
}

export async function setBudget(db: DB, actor: Actor, projectId: string, rows: { costCodeId: string; amount: string; note?: string | null }[]) {
  requirePerm(actor, "contract.manage");
  if (!can(actor, "cost.view")) throw forbidden("Budgets need permission to see costs.");
  requireProject(actor, projectId, "Project");
  for (const r of rows) if (dec(r.amount).lt(0)) throw rule("INVALID_VALUE", "Budget amounts cannot be negative.");
  try {
    await db.transaction(async (tx) => {
      for (const r of rows) {
        await tx.insert(projectBudgets).values({ projectId, costCodeId: r.costCodeId, amount: m2(r.amount), note: r.note ?? null, updatedBy: actor.userId })
          .onConflictDoUpdate({ target: [projectBudgets.projectId, projectBudgets.costCodeId], set: { amount: m2(r.amount), note: r.note ?? null, updatedBy: actor.userId, updatedAt: new Date() } });
      }
      await audit(tx, actor, "budget.set", "project", projectId, projectId, { lines: rows.length, total: m2(sum(rows.map((r) => r.amount))) });
    });
  } catch (e) {
    if (pgCode(e) === "23503") throw rule("UNKNOWN_COST_CODE", "A cost code does not exist.");
    throw e;
  }
  return getBudget(db, actor, projectId);
}

/** Contract figures for the owner's overview (contract.view only). */
export async function contractSnapshot(db: DbOrTx, projectIds: string[]) {
  if (!projectIds.length) return new Map<string, { contractValue: string; boqStatus: string; workDone: string; workDonePct: string; expiring: number; expired: number }>();
  const cs = await db.select().from(contracts).where(inArray(contracts.projectId, projectIds));
  const secs = cs.length ? await db.select().from(contractSecurities).where(and(inArray(contractSecurities.contractId, cs.map((c) => c.id)), eq(contractSecurities.status, "active"))) : [];
  const today = businessToday();
  const out = new Map<string, { contractValue: string; boqStatus: string; workDone: string; workDonePct: string; expiring: number; expired: number }>();
  for (const c of cs) {
    const s = await boqSummary(db, c);
    const mine = secs.filter((x) => x.contractId === c.id).map((x) => securityState(x, today).state);
    out.set(c.projectId, { contractValue: c.contractValue, boqStatus: c.boqStatus, workDone: s.workDone, workDonePct: s.workDonePct, expiring: mine.filter((x) => x === "expiring").length, expired: mine.filter((x) => x === "expired").length });
  }
  return out;
}

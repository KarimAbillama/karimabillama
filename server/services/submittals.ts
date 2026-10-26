/**
 * Submittals register: shop drawings, material submittals, samples, mock-ups and method statements.
 *
 *   draft → with_consultant → consultant response → approved | revise_resubmit | rejected | closed
 *   revise_resubmit / rejected → resubmit as the next revision → with_consultant
 *
 * "Ball in court": the consultant holds it while it is with_consultant; EDGE holds it while it is a
 * draft or must be resubmitted. Each project has its own consultant codes, each mapped to an
 * outcome (A-27). The consultant's review period comes from the project (A-28). An item linked to a
 * submittal cannot go on a PO for approval on that project until a submittal for it is approved (A-29).
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DB, DbOrTx, Tx } from "../db/client.js";
import {
  companies, items, projects, submittalCodes, submittalItems, submittalRevisions, submittals, users,
  type SubmittalOutcome, type SubmittalStatus,
} from "../db/schema.js";
import { type Actor, projectScope, requirePerm, requireProject } from "../auth/actor.js";
import { audit } from "../lib/audit.js";
import { addDays, businessToday, daysBetween } from "../lib/dates.js";
import { conflict, notFound, rule } from "../lib/errors.js";
import { nextDocNumber } from "../lib/numbering.js";

export const SUBMITTAL_TYPES = ["shop_drawing", "material", "sample", "mockup", "method_statement", "other"] as const;
export const DISCIPLINES = ["civil", "structural", "architectural", "mechanical", "electrical", "plumbing", "fire", "landscape", "other"] as const;
export const OUTCOMES = ["approved", "approved_as_noted", "revise_resubmit", "rejected", "for_information"] as const;

/** Statuses in which the submittal no longer needs action and no longer blocks anything. */
const DONE: SubmittalStatus[] = ["approved", "closed", "cancelled"];
const STATUS_AFTER: Record<SubmittalOutcome, SubmittalStatus> = {
  approved: "approved", approved_as_noted: "approved", revise_resubmit: "revise_resubmit", rejected: "rejected", for_information: "closed",
};

export interface SubmittalInput {
  projectId: string; type: (typeof SUBMITTAL_TYPES)[number]; title: string; discipline: (typeof DISCIPLINES)[number];
  specSection?: string | null; area?: string | null; subcontractorId?: string | null; consultantId?: string | null;
  requiredBy?: string | null; itemIds?: string[];
}

// ───────────── consultant codes ─────────────

export async function listCodes(db: DbOrTx, actor: Actor, projectId: string) {
  requirePerm(actor, "submittal.view");
  requireProject(actor, projectId, "Project");
  return db.select().from(submittalCodes).where(eq(submittalCodes.projectId, projectId)).orderBy(asc(submittalCodes.sortOrder), asc(submittalCodes.code));
}

/** Replaces the project's code list. Codes already used on a response cannot be removed or re-meant. */
export async function setCodes(db: DB, actor: Actor, projectId: string, codes: { code: string; label: string; outcome: SubmittalOutcome }[]) {
  requirePerm(actor, "submittal.manage");
  requireProject(actor, projectId, "Project");
  if (!codes.length) throw rule("NO_CODES", "Add at least one code.");
  const keys = codes.map((c) => c.code.trim());
  if (new Set(keys).size !== keys.length) throw rule("DUPLICATE_CODE", "Each code may appear only once.");
  if (!codes.some((c) => c.outcome === "approved" || c.outcome === "approved_as_noted")) throw rule("NO_APPROVAL_CODE", "At least one code must mean approved.");
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(submittalCodes).where(eq(submittalCodes.projectId, projectId));
    const used = new Set(existing.length
      ? (await tx.select({ id: submittalRevisions.codeId }).from(submittalRevisions).where(inArray(submittalRevisions.codeId, existing.map((c) => c.id)))).map((r) => r.id)
      : []);
    for (const old of existing) {
      const next = codes.find((c) => c.code.trim() === old.code);
      if (used.has(old.id) && (!next || next.outcome !== old.outcome)) {
        throw rule("CODE_IN_USE", `Code ${old.code} is already used on a consultant response, so it cannot be removed or given a different meaning.`);
      }
      if (!next) await tx.delete(submittalCodes).where(eq(submittalCodes.id, old.id));
    }
    for (const [i, c] of codes.entries()) {
      await tx.insert(submittalCodes).values({ projectId, code: c.code.trim(), label: c.label.trim(), outcome: c.outcome, sortOrder: i })
        .onConflictDoUpdate({ target: [submittalCodes.projectId, submittalCodes.code], set: { label: c.label.trim(), outcome: c.outcome, sortOrder: i } });
    }
    await audit(tx, actor, "submittal.codes_set", "project", projectId, projectId, { codes: keys.join(", ") });
    return tx.select().from(submittalCodes).where(eq(submittalCodes.projectId, projectId)).orderBy(asc(submittalCodes.sortOrder));
  });
}

// ───────────── register ─────────────

async function validate(tx: DbOrTx, input: Omit<SubmittalInput, "projectId">) {
  if (!input.title.trim()) throw rule("TITLE_REQUIRED", "Give the submittal a title.");
  for (const [id, what] of [[input.subcontractorId, "subcontractor"], [input.consultantId, "consultant"]] as const) {
    if (!id) continue;
    const [c] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, id));
    if (!c) throw rule("UNKNOWN_COMPANY", `The ${what} does not exist.`);
  }
  const ids = [...new Set(input.itemIds ?? [])];
  if (ids.length) {
    const found = await tx.select({ id: items.id }).from(items).where(inArray(items.id, ids));
    if (found.length !== ids.length) throw rule("UNKNOWN_ITEM", "One or more items do not exist.");
  }
  return ids;
}

export async function createSubmittal(db: DB, actor: Actor, input: SubmittalInput) {
  requirePerm(actor, "submittal.manage");
  requireProject(actor, input.projectId, "Project");
  return db.transaction(async (tx) => {
    const itemIds = await validate(tx, input);
    const [p] = await tx.select({ consultantId: projects.consultantCompanyId }).from(projects).where(eq(projects.id, input.projectId));
    const number = await nextDocNumber(tx, "SUB");
    const [s] = await tx.insert(submittals).values({
      number, projectId: input.projectId, type: input.type, title: input.title.trim(), discipline: input.discipline,
      specSection: input.specSection ?? null, area: input.area ?? null, subcontractorId: input.subcontractorId ?? null,
      consultantId: input.consultantId ?? p?.consultantId ?? null, requiredBy: input.requiredBy ?? null, status: "draft", createdBy: actor.userId,
    }).returning();
    if (itemIds.length) await tx.insert(submittalItems).values(itemIds.map((itemId) => ({ submittalId: s.id, itemId })));
    await audit(tx, actor, "submittal.created", "submittal", s.id, s.projectId, { number, type: s.type, title: s.title });
    return s;
  });
}

async function lockSubmittal(tx: Tx, actor: Actor, id: string, version?: number) {
  const res = await tx.execute<{ id: string }>(sql`select id from submittals where id = ${id} for update`);
  if (!res.rows.length) throw notFound("Submittal");
  const [s] = await tx.select().from(submittals).where(eq(submittals.id, id));
  requireProject(actor, s.projectId, "Submittal");
  if (version !== undefined && version !== s.version) throw conflict("This submittal was changed by someone else. Reload and try again.");
  return s;
}

export async function updateSubmittal(db: DB, actor: Actor, id: string, input: Omit<SubmittalInput, "projectId"> & { version: number }) {
  requirePerm(actor, "submittal.manage");
  return db.transaction(async (tx) => {
    const s = await lockSubmittal(tx, actor, id, input.version);
    if (DONE.includes(s.status)) throw rule("INVALID_STATE", "Approved, closed or cancelled submittals cannot be edited.");
    const itemIds = await validate(tx, input);
    const [u] = await tx.update(submittals).set({
      type: input.type, title: input.title.trim(), discipline: input.discipline, specSection: input.specSection ?? null, area: input.area ?? null,
      subcontractorId: input.subcontractorId ?? null, consultantId: input.consultantId ?? s.consultantId, requiredBy: input.requiredBy ?? null,
      version: s.version + 1, updatedAt: new Date(),
    }).where(eq(submittals.id, id)).returning();
    await tx.delete(submittalItems).where(eq(submittalItems.submittalId, id));
    if (itemIds.length) await tx.insert(submittalItems).values(itemIds.map((itemId) => ({ submittalId: id, itemId })));
    await audit(tx, actor, "submittal.updated", "submittal", id, s.projectId, { number: s.number });
    return u;
  });
}

/** Sends the draft (revision 0) or the next revision after "revise and resubmit" / "rejected". */
export async function submitToConsultant(db: DB, actor: Actor, id: string, input: { submittedDate: string; transmittalRef?: string | null; notes?: string | null; version?: number }) {
  requirePerm(actor, "submittal.manage");
  return db.transaction(async (tx) => {
    const s = await lockSubmittal(tx, actor, id, input.version);
    if (!["draft", "revise_resubmit", "rejected"].includes(s.status)) throw rule("INVALID_STATE", "Only a draft, or a submittal returned for resubmission, can be sent to the consultant.");
    if (input.submittedDate > businessToday()) throw rule("FUTURE_DATE", "The submission date cannot be in the future.");
    const revNo = s.status === "draft" ? s.currentRevision : s.currentRevision + 1;
    const [last] = await tx.select().from(submittalRevisions).where(eq(submittalRevisions.submittalId, id)).orderBy(desc(submittalRevisions.revNo)).limit(1);
    if (last?.returnedDate && input.submittedDate < last.returnedDate) throw rule("DATE_ORDER", "A resubmission cannot be dated before the consultant returned the previous revision.");
    const [p] = await tx.select({ days: projects.submittalReviewDays }).from(projects).where(eq(projects.id, s.projectId));
    const dueDate = addDays(input.submittedDate, p.days);
    await tx.insert(submittalRevisions).values({
      submittalId: id, revNo, submittedDate: input.submittedDate, dueDate, transmittalRef: input.transmittalRef ?? null, notes: input.notes ?? null, submittedBy: actor.userId,
    });
    await tx.update(submittals).set({ status: "with_consultant", currentRevision: revNo, version: s.version + 1, updatedAt: new Date() }).where(eq(submittals.id, id));
    await audit(tx, actor, "submittal.submitted", "submittal", id, s.projectId, { number: s.number, revision: revNo, dueDate, transmittal: input.transmittalRef ?? null });
    return { revNo, dueDate };
  });
}

export async function recordResponse(db: DB, actor: Actor, id: string, input: {
  codeId: string; returnedDate: string; consultantComments?: string | null; reviewerName?: string | null; inspectionDate?: string | null; version?: number;
}) {
  requirePerm(actor, "submittal.manage");
  return db.transaction(async (tx) => {
    const s = await lockSubmittal(tx, actor, id, input.version);
    if (s.status !== "with_consultant") throw rule("INVALID_STATE", "This submittal is not waiting for a consultant response.");
    const [code] = await tx.select().from(submittalCodes).where(and(eq(submittalCodes.id, input.codeId), eq(submittalCodes.projectId, s.projectId)));
    if (!code) throw rule("UNKNOWN_CODE", "Choose one of this project's consultant codes.");
    const [rev] = await tx.select().from(submittalRevisions).where(and(eq(submittalRevisions.submittalId, id), eq(submittalRevisions.revNo, s.currentRevision)));
    if (input.returnedDate < rev.submittedDate) throw rule("DATE_ORDER", "The response cannot be dated before the submission.");
    if (input.returnedDate > businessToday()) throw rule("FUTURE_DATE", "The response date cannot be in the future.");
    if ((code.outcome === "revise_resubmit" || code.outcome === "rejected") && !input.consultantComments?.trim()) {
      throw rule("COMMENTS_REQUIRED", "Record the consultant's comments so the team knows what to change.");
    }
    await tx.update(submittalRevisions).set({
      returnedDate: input.returnedDate, codeId: code.id, outcome: code.outcome, consultantComments: input.consultantComments ?? null,
      reviewerName: input.reviewerName ?? null, inspectionDate: input.inspectionDate ?? null, recordedBy: actor.userId, recordedAt: new Date(),
    }).where(eq(submittalRevisions.id, rev.id));
    const status = STATUS_AFTER[code.outcome];
    await tx.update(submittals).set({ status, version: s.version + 1, updatedAt: new Date() }).where(eq(submittals.id, id));
    await audit(tx, actor, "submittal.response", "submittal", id, s.projectId, { number: s.number, revision: rev.revNo, code: code.code, outcome: code.outcome });
    return { status };
  });
}

export async function cancelSubmittal(db: DB, actor: Actor, id: string, reason: string) {
  requirePerm(actor, "submittal.manage");
  return db.transaction(async (tx) => {
    const s = await lockSubmittal(tx, actor, id);
    if (DONE.includes(s.status)) throw rule("INVALID_STATE", "This submittal is already approved, closed or cancelled.");
    await tx.update(submittals).set({ status: "cancelled", version: s.version + 1, updatedAt: new Date() }).where(eq(submittals.id, id));
    await audit(tx, actor, "submittal.cancelled", "submittal", id, s.projectId, { number: s.number, reason });
  });
}

// ───────────── read models ─────────────

type Rev = typeof submittalRevisions.$inferSelect;

/** Derived state used by lists, detail, dashboard and overview. `today` is a Dubai date. */
export function submittalState(s: { status: SubmittalStatus; requiredBy: string | null }, current: Rev | undefined, today: string) {
  const withConsultant = s.status === "with_consultant";
  const ballInCourt = withConsultant ? "consultant" : DONE.includes(s.status) ? null : "edge";
  const daysWithConsultant = withConsultant && current ? daysBetween(current.submittedDate, today) : null;
  const daysOverdue = withConsultant && current ? Math.max(0, daysBetween(current.dueDate, today)) : 0;
  const lateForSite = !!s.requiredBy && s.requiredBy < today && !DONE.includes(s.status);
  return { ballInCourt, daysWithConsultant, dueDate: withConsultant ? current?.dueDate ?? null : null, daysOverdue, overdue: daysOverdue > 0, lateForSite };
}

const cons = alias(companies, "cons");
const sub = alias(companies, "sub");
const submitter = alias(users, "submitter");
const recorder = alias(users, "recorder");

async function loadRows(db: DbOrTx, where: ReturnType<typeof and>) {
  const rows = await db.select({
    s: submittals, projectCode: projects.code, projectName: projects.name, consultantName: cons.name, subcontractorName: sub.name,
  }).from(submittals)
    .innerJoin(projects, eq(projects.id, submittals.projectId))
    .leftJoin(cons, eq(cons.id, submittals.consultantId))
    .leftJoin(sub, eq(sub.id, submittals.subcontractorId))
    .where(where).orderBy(desc(submittals.createdAt));
  const ids = rows.map((r) => r.s.id);
  const revs = ids.length ? await db.select().from(submittalRevisions).where(inArray(submittalRevisions.submittalId, ids)) : [];
  const today = businessToday();
  return rows.map((r) => {
    const current = revs.find((v) => v.submittalId === r.s.id && v.revNo === r.s.currentRevision);
    return { ...r.s, projectCode: r.projectCode, projectName: r.projectName, consultantName: r.consultantName, subcontractorName: r.subcontractorName,
      lastOutcome: [...revs].filter((v) => v.submittalId === r.s.id && v.outcome).sort((a, b) => b.revNo - a.revNo)[0]?.outcome ?? null,
      ...submittalState(r.s, current, today) };
  });
}

export async function listSubmittals(db: DbOrTx, actor: Actor, f: { projectId?: string; status?: string; type?: string; ball?: "consultant" | "edge"; overdue?: boolean }) {
  requirePerm(actor, "submittal.view");
  const scope = projectScope(actor);
  if (f.projectId) requireProject(actor, f.projectId, "Project");
  const rows = await loadRows(db, and(
    scope ? (scope.length ? inArray(submittals.projectId, scope) : sql`false`) : undefined,
    f.projectId ? eq(submittals.projectId, f.projectId) : undefined,
    f.status ? eq(submittals.status, f.status as SubmittalStatus) : undefined,
    f.type ? eq(submittals.type, f.type as SubmittalInput["type"]) : undefined,
  ));
  return rows.filter((r) => (!f.ball || r.ballInCourt === f.ball) && (!f.overdue || r.overdue || r.lateForSite));
}

export async function getSubmittal(db: DbOrTx, actor: Actor, id: string) {
  requirePerm(actor, "submittal.view");
  const [row] = await loadRows(db, eq(submittals.id, id));
  if (!row) throw notFound("Submittal");
  requireProject(actor, row.projectId, "Submittal");
  const revisions = await db.select({
    r: submittalRevisions, code: submittalCodes.code, codeLabel: submittalCodes.label, submittedByName: submitter.fullName, recordedByName: recorder.fullName,
  }).from(submittalRevisions)
    .leftJoin(submittalCodes, eq(submittalCodes.id, submittalRevisions.codeId))
    .innerJoin(submitter, eq(submitter.id, submittalRevisions.submittedBy))
    .leftJoin(recorder, eq(recorder.id, submittalRevisions.recordedBy))
    .where(eq(submittalRevisions.submittalId, id)).orderBy(desc(submittalRevisions.revNo));
  const linked = await db.select({ id: items.id, code: items.code, description: items.description }).from(submittalItems)
    .innerJoin(items, eq(items.id, submittalItems.itemId)).where(eq(submittalItems.submittalId, id)).orderBy(asc(items.code));
  const [creator] = await db.select({ name: users.fullName }).from(users).where(eq(users.id, row.createdBy));
  return {
    ...row, creatorName: creator?.name ?? null, items: linked,
    revisions: revisions.map((x) => ({ ...x.r, code: x.code, codeLabel: x.codeLabel, submittedByName: x.submittedByName, recordedByName: x.recordedByName })),
    codes: await db.select().from(submittalCodes).where(eq(submittalCodes.projectId, row.projectId)).orderBy(asc(submittalCodes.sortOrder)),
  };
}

/**
 * Submittals that stop these items being ordered on the project: the item is linked to at least one
 * live submittal there and none of its submittals is approved yet.
 */
export async function blockingSubmittals(db: DbOrTx, projectId: string, itemIds: string[]) {
  if (!itemIds.length) return [];
  const rows = await db.select({ itemId: submittalItems.itemId, itemCode: items.code, number: submittals.number, status: submittals.status })
    .from(submittalItems)
    .innerJoin(submittals, eq(submittals.id, submittalItems.submittalId))
    .innerJoin(items, eq(items.id, submittalItems.itemId))
    .where(and(eq(submittals.projectId, projectId), inArray(submittalItems.itemId, itemIds), sql`${submittals.status} <> 'cancelled'`));
  const out: { itemCode: string; numbers: string[] }[] = [];
  for (const itemId of new Set(rows.map((r) => r.itemId))) {
    const mine = rows.filter((r) => r.itemId === itemId);
    if (mine.some((r) => r.status === "approved" || r.status === "closed")) continue;
    out.push({ itemCode: mine[0].itemCode, numbers: mine.map((r) => `${r.number} (${r.status.replace(/_/g, " ")})`) });
  }
  return out;
}

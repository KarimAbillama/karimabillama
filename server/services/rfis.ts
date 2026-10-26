/**
 * RFIs (requests for information to the consultant).
 *
 *   draft → internal_review → issued → responded → closed
 *            ↘ returned (to the originator, with a comment) → internal_review
 *   responded → issued again (answer incomplete: re-issued as the next round)
 *   any open state → cancelled
 *
 * Every transition is written to rfi_events (append-only). The consultant's response is recorded
 * separately from EDGE's internal closure, and a response never authorises a variation: closing an
 * RFI with a cost or time impact only flags it for the commercial team (A-37).
 * The consultant has `projects.rfi_response_days` to answer unless the RFI gives a date (A-36).
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DB, DbOrTx, Tx } from "../db/client.js";
import { companies, drawingRevisions, drawings, projects, rfiEvents, rfiResponses, rfis, users, type Impact, type RfiStatus } from "../db/schema.js";
import { type Actor, projectScope, requirePerm, requireProject } from "../auth/actor.js";
import { audit } from "../lib/audit.js";
import { addDays, businessToday, daysBetween } from "../lib/dates.js";
import { conflict, forbidden, notFound, rule } from "../lib/errors.js";
import { nextDocNumber } from "../lib/numbering.js";
import { revisionInfo, supersededWarning } from "./drawings.js";

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const IMPACTS = ["none", "possible", "yes"] as const;
const OPEN: RfiStatus[] = ["draft", "internal_review", "returned", "issued", "responded"];

export interface RfiInput {
  projectId: string; discipline: string; subject: string; question: string; location?: string | null; drawingRevisionId?: string | null;
  boqRef?: string | null; blockedActivity?: string | null; originatorCompanyId?: string | null; assigneeId?: string | null; recipientCompanyId?: string | null;
  priority?: (typeof PRIORITIES)[number]; costImpact?: Impact; timeImpact?: Impact; responseDueDate?: string | null;
}

async function validate(tx: DbOrTx, input: Omit<RfiInput, "projectId">, projectId: string) {
  if (!input.subject.trim() || !input.question.trim()) throw rule("REQUIRED", "Enter the subject and the question.");
  let warning: string | null = null;
  if (input.drawingRevisionId) {
    const info = await revisionInfo(tx, input.drawingRevisionId);
    if (!info || info.projectId !== projectId) throw rule("INVALID_DRAWING", "The drawing revision does not belong to this project.");
    warning = supersededWarning(info);
  }
  if (input.assigneeId) {
    const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, input.assigneeId), eq(users.isActive, true)));
    if (!u) throw rule("UNKNOWN_USER", "The person responsible does not exist.");
  }
  return warning;
}

async function event(tx: Tx, actor: Actor, rfiId: string, from: RfiStatus | null, to: RfiStatus, note?: string | null) {
  await tx.insert(rfiEvents).values({ rfiId, fromStatus: from, toStatus: to, note: note ?? null, userId: actor.userId });
}

const fields = (i: Omit<RfiInput, "projectId">) => ({
  discipline: i.discipline, subject: i.subject.trim(), question: i.question.trim(), location: i.location ?? null, drawingRevisionId: i.drawingRevisionId ?? null,
  boqRef: i.boqRef ?? null, blockedActivity: i.blockedActivity ?? null, originatorCompanyId: i.originatorCompanyId ?? null, assigneeId: i.assigneeId ?? null,
  priority: i.priority ?? "normal", costImpact: i.costImpact ?? "none", timeImpact: i.timeImpact ?? "none", responseDueDate: i.responseDueDate ?? null,
});

export async function createRfi(db: DB, actor: Actor, input: RfiInput) {
  requirePerm(actor, "rfi.create");
  requireProject(actor, input.projectId, "Project");
  return db.transaction(async (tx) => {
    const warning = await validate(tx, input, input.projectId);
    const [p] = await tx.select({ consultantId: projects.consultantCompanyId }).from(projects).where(eq(projects.id, input.projectId));
    const number = await nextDocNumber(tx, "RFI");
    const [r] = await tx.insert(rfis).values({
      number, projectId: input.projectId, ...fields(input), recipientCompanyId: input.recipientCompanyId ?? p?.consultantId ?? null,
      originatorId: actor.userId, assigneeId: input.assigneeId ?? actor.userId, status: "draft",
    }).returning();
    await event(tx, actor, r.id, null, "draft");
    await audit(tx, actor, "rfi.created", "rfi", r.id, r.projectId, { number, subject: r.subject });
    return { ...r, warnings: warning ? [warning] : [] };
  });
}

async function lockRfi(tx: Tx, actor: Actor, id: string, version?: number) {
  const res = await tx.execute<{ id: string }>(sql`select id from rfis where id = ${id} for update`);
  if (!res.rows.length) throw notFound("RFI");
  const [r] = await tx.select().from(rfis).where(eq(rfis.id, id));
  requireProject(actor, r.projectId, "RFI");
  if (version !== undefined && version !== r.version) throw conflict("This RFI was changed by someone else. Reload and try again.");
  return r;
}

async function move(tx: Tx, actor: Actor, r: typeof rfis.$inferSelect, to: RfiStatus, set: Partial<typeof rfis.$inferInsert> = {}, note?: string | null) {
  await tx.update(rfis).set({ ...set, status: to, version: r.version + 1, updatedAt: new Date() }).where(eq(rfis.id, r.id));
  await event(tx, actor, r.id, r.status, to, note);
  await audit(tx, actor, `rfi.${to}`, "rfi", r.id, r.projectId, { number: r.number, note: note ?? null });
}

export async function updateRfi(db: DB, actor: Actor, id: string, input: Omit<RfiInput, "projectId"> & { version: number }) {
  requirePerm(actor, "rfi.create");
  return db.transaction(async (tx) => {
    const r = await lockRfi(tx, actor, id, input.version);
    if (!["draft", "returned", "internal_review"].includes(r.status)) throw rule("INVALID_STATE", "An RFI can only be edited before it is issued.");
    if (r.originatorId !== actor.userId && !actor.permissions.has("rfi.issue")) throw forbidden("Only the originator or a reviewer can edit this RFI.");
    const warning = await validate(tx, input, r.projectId);
    const [u] = await tx.update(rfis).set({ ...fields(input), recipientCompanyId: input.recipientCompanyId ?? r.recipientCompanyId, version: r.version + 1, updatedAt: new Date() })
      .where(eq(rfis.id, id)).returning();
    await audit(tx, actor, "rfi.updated", "rfi", id, r.projectId, { number: r.number });
    return { ...u, warnings: warning ? [warning] : [] };
  });
}

export async function sendForReview(db: DB, actor: Actor, id: string) {
  requirePerm(actor, "rfi.create");
  return db.transaction(async (tx) => {
    const r = await lockRfi(tx, actor, id);
    if (!["draft", "returned"].includes(r.status)) throw rule("INVALID_STATE", "Only a draft or returned RFI can be sent for review.");
    await move(tx, actor, r, "internal_review");
  });
}

export async function returnRfi(db: DB, actor: Actor, id: string, comment: string) {
  requirePerm(actor, "rfi.issue");
  if (!comment?.trim()) throw rule("COMMENT_REQUIRED", "Say what the originator should change.");
  return db.transaction(async (tx) => {
    const r = await lockRfi(tx, actor, id);
    if (r.status !== "internal_review") throw rule("INVALID_STATE", "Only an RFI in internal review can be returned.");
    await move(tx, actor, r, "returned", {}, comment);
  });
}

/** Issues the RFI to the consultant (first time from review or draft; again after an incomplete answer). */
export async function issueRfi(db: DB, actor: Actor, id: string, input: { issueDate: string; transmittalRef?: string | null; responseDueDate?: string | null; note?: string | null }) {
  requirePerm(actor, "rfi.issue");
  return db.transaction(async (tx) => {
    const r = await lockRfi(tx, actor, id);
    const reissue = r.status === "responded";
    if (!["draft", "internal_review", "responded"].includes(r.status)) throw rule("INVALID_STATE", "This RFI cannot be issued now.");
    if (reissue && !input.note?.trim()) throw rule("NOTE_REQUIRED", "Say why the answer is not enough before issuing again.");
    if (input.issueDate > businessToday()) throw rule("FUTURE_DATE", "The issue date cannot be in the future.");
    if (r.issueDate && input.issueDate < r.issueDate) throw rule("DATE_ORDER", "It cannot be issued before its previous issue date.");
    const [p] = await tx.select({ days: projects.rfiResponseDays }).from(projects).where(eq(projects.id, r.projectId));
    const due = input.responseDueDate ?? (reissue ? null : r.responseDueDate) ?? addDays(input.issueDate, p.days);
    if (due < input.issueDate) throw rule("DATE_ORDER", "The response due date cannot be before the issue date.");
    await move(tx, actor, r, "issued", { issueDate: input.issueDate, responseDueDate: due, transmittalRef: input.transmittalRef ?? r.transmittalRef, round: r.round + 1 }, input.note ?? null);
    return { round: r.round + 1, responseDueDate: due };
  });
}

/** Records the consultant's answer. It does not close the RFI and does not approve any variation. */
export async function recordRfiResponse(db: DB, actor: Actor, id: string, input: { responseDate: string; response: string; responderName?: string | null; reference?: string | null }) {
  requirePerm(actor, "rfi.issue");
  if (!input.response?.trim()) throw rule("RESPONSE_REQUIRED", "Enter the consultant's answer.");
  return db.transaction(async (tx) => {
    const r = await lockRfi(tx, actor, id);
    if (r.status !== "issued") throw rule("INVALID_STATE", "This RFI is not waiting for a consultant response.");
    if (input.responseDate < r.issueDate!) throw rule("DATE_ORDER", "The response cannot be dated before the RFI was issued.");
    if (input.responseDate > businessToday()) throw rule("FUTURE_DATE", "The response date cannot be in the future.");
    await tx.insert(rfiResponses).values({ rfiId: id, round: r.round, responseDate: input.responseDate, response: input.response.trim(),
      responderName: input.responderName ?? null, reference: input.reference ?? null, recordedBy: actor.userId });
    await move(tx, actor, r, "responded", {}, input.reference ? `Response ref. ${input.reference}` : null);
  });
}

/** EDGE's internal closure, after acting on the answer. Kept separate from the consultant's response. */
export async function closeRfi(db: DB, actor: Actor, id: string, input: { closedDate: string; closureNote: string }) {
  requirePerm(actor, "rfi.issue");
  if (!input.closureNote?.trim()) throw rule("NOTE_REQUIRED", "Say what was done with the answer.");
  return db.transaction(async (tx) => {
    const r = await lockRfi(tx, actor, id);
    if (r.status !== "responded") throw rule("INVALID_STATE", "Only an answered RFI can be closed.");
    if (input.closedDate > businessToday()) throw rule("FUTURE_DATE", "The closure date cannot be in the future.");
    await move(tx, actor, r, "closed", { closedDate: input.closedDate, closureNote: input.closureNote.trim() }, input.closureNote);
    return { potentialVariation: r.costImpact !== "none" || r.timeImpact !== "none" };
  });
}

export async function cancelRfi(db: DB, actor: Actor, id: string, reason: string) {
  requirePerm(actor, "rfi.create");
  if (!reason?.trim()) throw rule("REASON_REQUIRED", "Give a reason.");
  return db.transaction(async (tx) => {
    const r = await lockRfi(tx, actor, id);
    if (!OPEN.includes(r.status)) throw rule("INVALID_STATE", "This RFI is already closed or cancelled.");
    if (["issued", "responded"].includes(r.status) && !actor.permissions.has("rfi.issue")) throw forbidden("Only a reviewer can withdraw an issued RFI.");
    await move(tx, actor, r, "cancelled", {}, reason);
  });
}

// ───────────── read models ─────────────

/** Who must act, for how long it has been open, and whether the consultant is late. */
export function rfiState(r: { status: RfiStatus; issueDate: string | null; responseDueDate: string | null }, today: string) {
  const ball = r.status === "issued" ? "consultant" : OPEN.includes(r.status) ? "edge" : null;
  const daysOpen = r.issueDate && OPEN.includes(r.status) ? daysBetween(r.issueDate, today) : null;
  const daysOverdue = r.status === "issued" && r.responseDueDate ? Math.max(0, daysBetween(r.responseDueDate, today)) : 0;
  return { ballInCourt: ball, daysOpen, daysOverdue, overdue: daysOverdue > 0 };
}

const originator = alias(users, "originator");
const assignee = alias(users, "assignee");
const recipient = alias(companies, "recipient");
const origCompany = alias(companies, "orig_company");

async function load(db: DbOrTx, where: ReturnType<typeof and>) {
  const rows = await db.select({
    r: rfis, projectCode: projects.code, projectName: projects.name, originatorName: originator.fullName, assigneeName: assignee.fullName,
    recipientName: recipient.name, originatorCompanyName: origCompany.name, drawingNumber: drawings.number, drawingId: drawings.id, revision: drawingRevisions.revision,
  }).from(rfis)
    .innerJoin(projects, eq(projects.id, rfis.projectId))
    .innerJoin(originator, eq(originator.id, rfis.originatorId))
    .leftJoin(assignee, eq(assignee.id, rfis.assigneeId))
    .leftJoin(recipient, eq(recipient.id, rfis.recipientCompanyId))
    .leftJoin(origCompany, eq(origCompany.id, rfis.originatorCompanyId))
    .leftJoin(drawingRevisions, eq(drawingRevisions.id, rfis.drawingRevisionId))
    .leftJoin(drawings, eq(drawings.id, drawingRevisions.drawingId))
    .where(where).orderBy(desc(rfis.createdAt));
  const today = businessToday();
  return rows.map((x) => {
    const st = rfiState(x.r, today);
    return { ...x.r, projectCode: x.projectCode, projectName: x.projectName, originatorName: x.originatorName, assigneeName: x.assigneeName, recipientName: x.recipientName,
      originatorCompanyName: x.originatorCompanyName, drawing: x.drawingId ? { id: x.drawingId, number: x.drawingNumber, revision: x.revision } : null,
      ...st, owner: st.ballInCourt === "consultant" ? (x.recipientName ?? "Consultant") : st.ballInCourt === "edge" ? (x.assigneeName ?? x.originatorName) : null };
  });
}

export async function listRfis(db: DbOrTx, actor: Actor, f: { projectId?: string; status?: string; ball?: "consultant" | "edge"; overdue?: boolean; q?: string }) {
  requirePerm(actor, "rfi.view");
  const scope = projectScope(actor);
  if (f.projectId) requireProject(actor, f.projectId, "Project");
  const rows = await load(db, and(
    scope ? (scope.length ? inArray(rfis.projectId, scope) : sql`false`) : undefined,
    f.projectId ? eq(rfis.projectId, f.projectId) : undefined,
    f.status ? eq(rfis.status, f.status as RfiStatus) : undefined,
    f.q ? sql`(${rfis.number} ilike ${`%${f.q}%`} or ${rfis.subject} ilike ${`%${f.q}%`} or ${rfis.question} ilike ${`%${f.q}%`})` : undefined,
  ));
  return rows.filter((r) => (!f.ball || r.ballInCourt === f.ball) && (!f.overdue || r.overdue));
}

export async function getRfi(db: DbOrTx, actor: Actor, id: string) {
  requirePerm(actor, "rfi.view");
  const [r] = await load(db, eq(rfis.id, id));
  if (!r) throw notFound("RFI");
  requireProject(actor, r.projectId, "RFI");
  const responses = await db.select({ x: rfiResponses, byName: users.fullName }).from(rfiResponses).innerJoin(users, eq(users.id, rfiResponses.recordedBy))
    .where(eq(rfiResponses.rfiId, id)).orderBy(asc(rfiResponses.round), asc(rfiResponses.recordedAt));
  const events = await db.select({ e: rfiEvents, byName: users.fullName }).from(rfiEvents).innerJoin(users, eq(users.id, rfiEvents.userId))
    .where(eq(rfiEvents.rfiId, id)).orderBy(asc(rfiEvents.id));
  const info = r.drawingRevisionId ? await revisionInfo(db, r.drawingRevisionId) : null;
  return {
    ...r,
    drawingInfo: info, drawingWarning: supersededWarning(info),
    potentialVariation: r.costImpact !== "none" || r.timeImpact !== "none",
    responses: responses.map((x) => ({ ...x.x, recordedByName: x.byName })),
    events: events.map((x) => ({ ...x.e, byName: x.byName })),
  };
}

/** People who may be made responsible for an RFI on this project. */
export async function rfiAssignees(db: DbOrTx, actor: Actor, projectId: string) {
  requirePerm(actor, "rfi.view");
  requireProject(actor, projectId, "Project");
  const members = await db.execute<{ id: string; full_name: string; all_projects: boolean; is_member: boolean }>(sql`
    select u.id, u.full_name,
      exists (select 1 from user_roles ur join roles ro on ro.id = ur.role_id where ur.user_id = u.id and ro.all_projects) as all_projects,
      exists (select 1 from project_members pm where pm.user_id = u.id and pm.project_id = ${projectId}) as is_member
    from users u
    where u.is_active and exists (select 1 from user_roles ur join role_permissions rp on rp.role_id = ur.role_id where ur.user_id = u.id and rp.permission in ('rfi.create','rfi.issue'))
    order by u.full_name`);
  return members.rows.filter((m) => m.is_member || m.all_projects).map((m) => ({ id: m.id, fullName: m.full_name }));
}


/**
 * Drawing register. Every revision is kept (append-only). For each drawing:
 *  - the newest revision issued "for construction" is the CURRENT CONSTRUCTION revision (what site builds from);
 *  - any other revision older than the newest is SUPERSEDED;
 *  - a newer revision that is not for construction (e.g. for approval) is shown as LATEST, not to build from.
 * "Newest" means latest issue date, then latest recorded.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DB, DbOrTx } from "../db/client.js";
import { drawingRevisions, drawings, projects, rfis, users, type DrawingPurpose } from "../db/schema.js";
import { type Actor, projectScope, requirePerm, requireProject } from "../auth/actor.js";
import { audit } from "../lib/audit.js";
import { businessToday } from "../lib/dates.js";
import { notFound, pgCode, rule } from "../lib/errors.js";

export const PURPOSES = ["tender", "for_information", "for_approval", "for_construction", "as_built"] as const;
export type RevisionState = "current_construction" | "latest" | "superseded";

export interface RevisionInput {
  revision: string; issueDate: string; purpose: DrawingPurpose; transmittalRef?: string | null; fileRef?: string | null; distribution?: string | null; notes?: string | null;
}

type Rev = typeof drawingRevisions.$inferSelect;
const newestFirst = (a: Rev, b: Rev) => b.issueDate.localeCompare(a.issueDate) || b.recordedAt.getTime() - a.recordedAt.getTime();

/** The state of each revision of one drawing, newest first. */
export function revisionStates(revs: Rev[]) {
  const sorted = [...revs].sort(newestFirst);
  const construction = sorted.find((r) => r.purpose === "for_construction");
  return sorted.map((r, i) => ({
    ...r,
    state: (r.id === construction?.id ? "current_construction" : i === 0 ? "latest" : "superseded") as RevisionState,
  }));
}

function checkRevision(input: RevisionInput) {
  if (!input.revision.trim()) throw rule("REVISION_REQUIRED", "Enter the revision (e.g. C03).");
  if (input.issueDate > businessToday()) throw rule("FUTURE_DATE", "The issue date cannot be in the future.");
}

export async function createDrawing(db: DB, actor: Actor, input: { projectId: string; number: string; title: string; discipline: string; firstRevision: RevisionInput }) {
  requirePerm(actor, "drawing.manage");
  requireProject(actor, input.projectId, "Project");
  if (!input.number.trim() || !input.title.trim()) throw rule("REQUIRED", "Enter the drawing number and title.");
  checkRevision(input.firstRevision);
  try {
    return await db.transaction(async (tx) => {
      const [d] = await tx.insert(drawings).values({ projectId: input.projectId, number: input.number.trim(), title: input.title.trim(), discipline: input.discipline, createdBy: actor.userId }).returning();
      await tx.insert(drawingRevisions).values({ drawingId: d.id, ...revValues(input.firstRevision), recordedBy: actor.userId });
      await audit(tx, actor, "drawing.registered", "drawing", d.id, d.projectId, { number: d.number, revision: input.firstRevision.revision });
      return d;
    });
  } catch (e) {
    if (pgCode(e) === "23505") throw rule("DRAWING_EXISTS", "This drawing number is already in the register for this project. Add a revision to it instead.");
    throw e;
  }
}

const revValues = (r: RevisionInput) => ({
  revision: r.revision.trim(), issueDate: r.issueDate, purpose: r.purpose, transmittalRef: r.transmittalRef ?? null, fileRef: r.fileRef ?? null,
  distribution: r.distribution ?? null, notes: r.notes ?? null,
});

export async function addRevision(db: DB, actor: Actor, drawingId: string, input: RevisionInput) {
  requirePerm(actor, "drawing.manage");
  checkRevision(input);
  const [d] = await db.select().from(drawings).where(eq(drawings.id, drawingId));
  if (!d) throw notFound("Drawing");
  requireProject(actor, d.projectId, "Drawing");
  try {
    return await db.transaction(async (tx) => {
      const [r] = await tx.insert(drawingRevisions).values({ drawingId, ...revValues(input), recordedBy: actor.userId }).returning();
      await audit(tx, actor, "drawing.revised", "drawing", drawingId, d.projectId, { number: d.number, revision: r.revision, purpose: r.purpose });
      return r;
    });
  } catch (e) {
    if (pgCode(e) === "23505") throw rule("REVISION_EXISTS", `Revision ${input.revision} of ${d.number} is already recorded.`);
    throw e;
  }
}

async function revisionsFor(db: DbOrTx, drawingIds: string[]) {
  return drawingIds.length ? db.select().from(drawingRevisions).where(inArray(drawingRevisions.drawingId, drawingIds)) : [];
}

export async function listDrawings(db: DbOrTx, actor: Actor, f: { projectId?: string; discipline?: string; q?: string }) {
  requirePerm(actor, "project.view");
  const scope = projectScope(actor);
  if (f.projectId) requireProject(actor, f.projectId, "Project");
  const rows = await db.select({ d: drawings, projectCode: projects.code }).from(drawings).innerJoin(projects, eq(projects.id, drawings.projectId))
    .where(and(
      scope ? (scope.length ? inArray(drawings.projectId, scope) : sql`false`) : undefined,
      f.projectId ? eq(drawings.projectId, f.projectId) : undefined,
      f.discipline ? eq(drawings.discipline, f.discipline) : undefined,
      f.q ? sql`(${drawings.number} ilike ${`%${f.q}%`} or ${drawings.title} ilike ${`%${f.q}%`})` : undefined,
    )).orderBy(asc(projects.code), asc(drawings.number));
  const revs = await revisionsFor(db, rows.map((r) => r.d.id));
  return rows.map(({ d, projectCode }) => {
    const states = revisionStates(revs.filter((r) => r.drawingId === d.id));
    const cc = states.find((r) => r.state === "current_construction");
    return { ...d, projectCode, revisions: states.length, latest: states[0] ? { id: states[0].id, revision: states[0].revision, issueDate: states[0].issueDate, purpose: states[0].purpose } : null,
      construction: cc ? { id: cc.id, revision: cc.revision, issueDate: cc.issueDate, fileRef: cc.fileRef } : null };
  });
}

export async function getDrawing(db: DbOrTx, actor: Actor, id: string) {
  requirePerm(actor, "project.view");
  const [row] = await db.select({ d: drawings, projectCode: projects.code, projectName: projects.name }).from(drawings).innerJoin(projects, eq(projects.id, drawings.projectId)).where(eq(drawings.id, id));
  if (!row) throw notFound("Drawing");
  requireProject(actor, row.d.projectId, "Drawing");
  const revs = await db.select({ r: drawingRevisions, byName: users.fullName }).from(drawingRevisions).innerJoin(users, eq(users.id, drawingRevisions.recordedBy)).where(eq(drawingRevisions.drawingId, id));
  const states = revisionStates(revs.map((x) => x.r)).map((r) => ({ ...r, recordedByName: revs.find((x) => x.r.id === r.id)!.byName }));
  const linkedRfis = states.length
    ? await db.select({ id: rfis.id, number: rfis.number, subject: rfis.subject, status: rfis.status, drawingRevisionId: rfis.drawingRevisionId })
      .from(rfis).where(inArray(rfis.drawingRevisionId, states.map((s) => s.id))).orderBy(desc(rfis.createdAt))
    : [];
  return { ...row.d, projectCode: row.projectCode, projectName: row.projectName, revisions: states,
    rfis: linkedRfis.map((r) => ({ ...r, revision: states.find((s) => s.id === r.drawingRevisionId)?.revision ?? null })) };
}

/** Where a revision stands now, used to warn about superseded drawings on RFIs. */
export async function revisionInfo(db: DbOrTx, revisionId: string) {
  const [r] = await db.select({ r: drawingRevisions, number: drawings.number, title: drawings.title, projectId: drawings.projectId })
    .from(drawingRevisions).innerJoin(drawings, eq(drawings.id, drawingRevisions.drawingId)).where(eq(drawingRevisions.id, revisionId));
  if (!r) return null;
  const states = revisionStates(await db.select().from(drawingRevisions).where(eq(drawingRevisions.drawingId, r.r.drawingId)));
  const me = states.find((s) => s.id === revisionId)!;
  const cc = states.find((s) => s.state === "current_construction");
  return { drawingId: r.r.drawingId, number: r.number, title: r.title, projectId: r.projectId, revision: r.r.revision, purpose: r.r.purpose, state: me.state,
    latestRevision: states[0].revision, constructionRevision: cc?.revision ?? null };
}

export const supersededWarning = (i: Awaited<ReturnType<typeof revisionInfo>>) =>
  i && i.state === "superseded" ? `${i.number} revision ${i.revision} is superseded. Current: ${i.constructionRevision ?? i.latestRevision}${i.constructionRevision ? " (for construction)" : ""}.` : null;

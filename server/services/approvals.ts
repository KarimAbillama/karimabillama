/**
 * Configurable sequential approvals.
 *
 *  - A rule is chosen by document type, project (project-specific rules win) and amount band.
 *  - Each step names a role. Any active user with that role and access to the project can decide,
 *    except the requester (unless the rule allows self-approval) and anyone who already approved an
 *    earlier step of the same request (segregation of duties).
 *  - Every decision records the approver, timestamp, document revision and comment.
 *  - A rejection requires a reason. Revising a document supersedes its old approval request, so a
 *    material change always needs fresh approval.
 *
 * Not yet implemented (Phase 2): delegation with expiry, overdue escalation, notifications.
 */
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "../db/client.js";
import {
  approvalRequests, approvalRules, approvalSteps, materialRequests, projects, purchaseOrders, users, type ApprovalDocType,
} from "../db/schema.js";
import { type Actor, canAccessProject, requireProject } from "../auth/actor.js";
import { audit } from "../lib/audit.js";
import { dec } from "../lib/decimal.js";
import { conflict, forbidden, notFound, rule } from "../lib/errors.js";

const DOC_TABLE = { material_request: materialRequests, purchase_order: purchaseOrders } as const;
const DOC_PERMISSION = { material_request: "mr.approve", purchase_order: "po.approve" } as const;

export interface ApprovableDoc {
  id: string;
  number: string;
  revision: number;
  projectId: string;
  amount: string | null;
}

async function pickRule(tx: DbOrTx, docType: ApprovalDocType, projectId: string, amount: string | null) {
  const rules = await tx
    .select()
    .from(approvalRules)
    .where(and(eq(approvalRules.docType, docType), eq(approvalRules.isActive, true), or(isNull(approvalRules.projectId), eq(approvalRules.projectId, projectId))));
  const a = dec(amount ?? 0);
  const matches = rules.filter((r) => a.gte(r.minAmount) && (r.maxAmount === null || a.lte(r.maxAmount)));
  // project-specific rules take precedence over company-wide ones
  return matches.find((r) => r.projectId === projectId) ?? matches.find((r) => r.projectId === null) ?? null;
}

export async function startApproval(tx: Tx, actor: Actor, docType: ApprovalDocType, doc: ApprovableDoc) {
  const r = await pickRule(tx, docType, doc.projectId, doc.amount);
  if (!r) throw rule("NO_APPROVAL_RULE", `No approval rule is configured for ${docType} of this value. Ask an administrator to configure one.`);
  // close any older open request for this document
  await tx
    .update(approvalRequests)
    .set({ status: "superseded", completedAt: new Date() })
    .where(and(eq(approvalRequests.docType, docType), eq(approvalRequests.docId, doc.id), eq(approvalRequests.status, "pending")));
  const [req] = await tx
    .insert(approvalRequests)
    .values({
      docType, docId: doc.id, docNumber: doc.number, docRevision: doc.revision, projectId: doc.projectId,
      amount: doc.amount, ruleId: r.id, status: "pending", requestedBy: actor.userId,
    })
    .returning();
  await tx.insert(approvalSteps).values(
    r.stepRoleKeys.map((roleKey, i) => ({
      requestId: req.id, stepNo: i + 1, roleKey, status: i === 0 ? ("pending" as const) : ("waiting" as const), docRevision: doc.revision,
    })),
  );
  await audit(tx, actor, "approval.requested", docType, doc.id, doc.projectId, { number: doc.number, revision: doc.revision, amount: doc.amount, steps: r.stepRoleKeys });
  return req;
}

/** Marks open approval requests for a document as superseded (used when a document is revised). */
export async function supersedeApprovals(tx: Tx, docType: ApprovalDocType, docId: string) {
  const open = await tx
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(and(eq(approvalRequests.docType, docType), eq(approvalRequests.docId, docId), inArray(approvalRequests.status, ["pending", "approved"])));
  if (!open.length) return;
  const ids = open.map((o) => o.id);
  await tx.update(approvalRequests).set({ status: "superseded", completedAt: new Date() }).where(inArray(approvalRequests.id, ids));
  await tx
    .update(approvalSteps)
    .set({ status: "cancelled" })
    .where(and(inArray(approvalSteps.requestId, ids), inArray(approvalSteps.status, ["pending", "waiting"])));
}

export async function decide(tx: Tx, actor: Actor, requestId: string, decision: "approve" | "reject", comment: string | undefined) {
  const locked = await tx.execute<{ id: string }>(sql`select id from approval_requests where id = ${requestId} for update`);
  if (!locked.rows.length) throw notFound("Approval request");
  const [req] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, requestId));
  requireProject(actor, req.projectId, "Approval request");
  if (!actor.permissions.has(DOC_PERMISSION[req.docType])) throw forbidden(`Missing permission: ${DOC_PERMISSION[req.docType]}`);
  if (req.status !== "pending") throw conflict(`This approval request is already ${req.status}.`);

  const steps = await tx.select().from(approvalSteps).where(eq(approvalSteps.requestId, requestId)).orderBy(asc(approvalSteps.stepNo));
  const step = steps.find((s) => s.status === "pending");
  if (!step) throw conflict("No step is awaiting a decision.");
  if (!actor.roleKeys.includes(step.roleKey)) throw forbidden(`Step ${step.stepNo} must be decided by a user with the role "${step.roleKey}".`);

  const [ruleRow] = req.ruleId ? await tx.select().from(approvalRules).where(eq(approvalRules.id, req.ruleId)) : [];
  if (req.requestedBy === actor.userId && !ruleRow?.allowSelfApproval) throw forbidden("You cannot approve or reject your own request.");
  if (steps.some((s) => s.status === "approved" && s.decidedBy === actor.userId)) {
    throw forbidden("You already approved an earlier step of this request; a different person must decide this step.");
  }

  // The document must still be at the revision that was submitted.
  const table = DOC_TABLE[req.docType];
  const [doc] = await tx.select({ revision: table.revision, status: table.status }).from(table).where(eq(table.id, req.docId));
  if (!doc || doc.revision !== req.docRevision || doc.status !== "pending_approval") {
    throw conflict("The document has changed since it was submitted. It must be resubmitted for approval.");
  }

  const trimmed = comment?.trim() || null;
  if (decision === "reject" && !trimmed) throw rule("REJECTION_REASON_REQUIRED", "A reason is required when rejecting.");
  const now = new Date();
  await tx
    .update(approvalSteps)
    .set({ status: decision === "approve" ? "approved" : "rejected", decidedBy: actor.userId, decidedAt: now, comment: trimmed, docRevision: req.docRevision })
    .where(eq(approvalSteps.id, step.id));

  let outcome: "pending" | "approved" | "rejected" = "pending";
  if (decision === "reject") {
    outcome = "rejected";
    await tx.update(approvalSteps).set({ status: "cancelled" }).where(and(eq(approvalSteps.requestId, requestId), eq(approvalSteps.status, "waiting")));
  } else {
    const next = steps.find((s) => s.stepNo === step.stepNo + 1);
    if (next) await tx.update(approvalSteps).set({ status: "pending" }).where(eq(approvalSteps.id, next.id));
    else outcome = "approved";
  }

  if (outcome !== "pending") {
    await tx.update(approvalRequests).set({ status: outcome, completedAt: now }).where(eq(approvalRequests.id, requestId));
    await tx
      .update(table)
      .set({ status: outcome, approvedAt: outcome === "approved" ? now : null, updatedAt: now, version: sql`${table.version} + 1` })
      .where(eq(table.id, req.docId));
  }
  await audit(tx, actor, `approval.${decision}`, req.docType, req.docId, req.projectId, {
    number: req.docNumber, revision: req.docRevision, step: step.stepNo, role: step.roleKey, comment: trimmed, outcome,
  });
  return { outcome, step: step.stepNo };
}

/** Approval history (all requests and steps) for a document, newest first. */
export async function approvalHistory(db: DbOrTx, docType: ApprovalDocType, docId: string) {
  const reqs = await db.select().from(approvalRequests)
    .where(and(eq(approvalRequests.docType, docType), eq(approvalRequests.docId, docId)))
    .orderBy(desc(approvalRequests.requestedAt));
  if (!reqs.length) return [];
  const steps = await db
    .select({ s: approvalSteps, deciderName: users.fullName })
    .from(approvalSteps)
    .leftJoin(users, eq(users.id, approvalSteps.decidedBy))
    .where(inArray(approvalSteps.requestId, reqs.map((r) => r.id)))
    .orderBy(asc(approvalSteps.stepNo));
  return reqs.map((r) => ({
    ...r,
    steps: steps.filter((s) => s.s.requestId === r.id).map((s) => ({ ...s.s, deciderName: s.deciderName })),
  }));
}

/** Requests currently waiting on a step this actor is allowed to decide. */
export async function myPendingApprovals(db: DbOrTx, actor: Actor) {
  if (!actor.roleKeys.length) return [];
  const rows = await db
    .select({
      requestId: approvalRequests.id,
      docType: approvalRequests.docType,
      docId: approvalRequests.docId,
      docNumber: approvalRequests.docNumber,
      docRevision: approvalRequests.docRevision,
      projectId: approvalRequests.projectId,
      projectCode: projects.code,
      amount: approvalRequests.amount,
      requestedAt: approvalRequests.requestedAt,
      requestedBy: approvalRequests.requestedBy,
      requesterName: users.fullName,
      stepNo: approvalSteps.stepNo,
      roleKey: approvalSteps.roleKey,
      allowSelf: approvalRules.allowSelfApproval,
    })
    .from(approvalSteps)
    .innerJoin(approvalRequests, eq(approvalRequests.id, approvalSteps.requestId))
    .innerJoin(projects, eq(projects.id, approvalRequests.projectId))
    .innerJoin(users, eq(users.id, approvalRequests.requestedBy))
    .leftJoin(approvalRules, eq(approvalRules.id, approvalRequests.ruleId))
    .where(and(eq(approvalSteps.status, "pending"), eq(approvalRequests.status, "pending"), inArray(approvalSteps.roleKey, actor.roleKeys)))
    .orderBy(asc(approvalRequests.requestedAt));
  const priorApprovals = rows.length
    ? await db.select({ requestId: approvalSteps.requestId, decidedBy: approvalSteps.decidedBy }).from(approvalSteps)
        .where(and(inArray(approvalSteps.requestId, rows.map((r) => r.requestId)), eq(approvalSteps.status, "approved")))
    : [];
  return rows
    .filter((r) => canAccessProject(actor, r.projectId))
    .filter((r) => actor.permissions.has(DOC_PERMISSION[r.docType]))
    .filter((r) => r.allowSelf || r.requestedBy !== actor.userId)
    .filter((r) => !priorApprovals.some((p) => p.requestId === r.requestId && p.decidedBy === actor.userId))
    .map(({ allowSelf: _a, ...r }) => r);
}

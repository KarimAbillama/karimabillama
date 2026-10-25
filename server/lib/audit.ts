import type { DbOrTx } from "../db/client.js";
import { auditEvents } from "../db/schema.js";
import type { Actor } from "../auth/actor.js";

/**
 * Append-only audit trail. Never put salaries, identity documents, bank details, passwords or
 * tokens in `details`.
 */
export async function audit(
  db: DbOrTx,
  actor: Actor | null,
  action: string,
  entityType: string,
  entityId: string | null,
  projectId: string | null,
  details?: Record<string, unknown>,
) {
  await db.insert(auditEvents).values({
    userId: actor?.userId ?? null,
    action,
    entityType,
    entityId,
    projectId,
    details: details ?? null,
    ip: actor?.ip ?? null,
  });
}

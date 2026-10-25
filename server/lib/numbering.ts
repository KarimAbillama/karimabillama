import { sql } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import { businessYear } from "./dates.js";

export type DocPrefix = "MR" | "PO" | "GRN" | "ISS" | "TRF";

/**
 * Concurrency-safe document numbers, e.g. PO-2026-00042.
 * The UPSERT takes a row lock on the sequence, so concurrent transactions queue rather than collide.
 * Numbers are never reused: cancelled documents keep their number. (A number can only be skipped
 * if the whole transaction rolls back, in which case no document was created.)
 */
export async function nextDocNumber(tx: Tx, prefix: DocPrefix, now = new Date()): Promise<string> {
  const year = businessYear(now);
  const key = `${prefix}-${year}`;
  const res = await tx.execute<{ last_value: number }>(sql`
    insert into document_sequences (key, last_value) values (${key}, 1)
    on conflict (key) do update set last_value = document_sequences.last_value + 1
    returning last_value`);
  const n = Number(res.rows[0].last_value);
  return `${key}-${String(n).padStart(5, "0")}`;
}

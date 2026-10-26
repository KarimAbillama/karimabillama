// Embedded PostgreSQL (PGlite, compiled to WebAssembly) for the offline desktop demo and for
// running the test suite without a database server. Production uses a real PostgreSQL server.
import { PGlite, types } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema.js";
import type { DB } from "./client.js";

/**
 * Opens an embedded database. `dataDir` is a folder on disk; leave it out for an in-memory database.
 * The returned object has the same query API as the server-backed `DB`, with the same type
 * parsing as `client.ts`: numeric and date as strings, int8 as number.
 */
export async function createPgliteDb(dataDir?: string): Promise<DB & { close(): Promise<void> }> {
  const client = await PGlite.create(dataDir, {
    parsers: {
      [types.NUMERIC]: (v: string) => v,
      [types.DATE]: (v: string) => v,
      [types.INT8]: (v: string) => Number(v),
    },
  });
  const db = drizzle({ client, schema });
  return Object.assign(db as unknown as DB, { close: () => client.close() });
}

export async function runPgliteMigrations(db: DB, migrationsFolder: string) {
  await migrate(db as never, { migrationsFolder });
}

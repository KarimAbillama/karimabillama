import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

// Return numeric columns as strings (never JS floats) and dates as plain "YYYY-MM-DD" strings.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => v);
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export type DB = NodePgDatabase<typeof schema> & { $client: pg.Pool };
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DbOrTx = DB | Tx;

export function createDb(connectionString: string, max = 10): DB {
  const pool = new pg.Pool({ connectionString, max });
  return drizzle(pool, { schema }) as DB;
}

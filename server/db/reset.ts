// Drops and recreates the public schema of the DEVELOPMENT database. Refuses to run in production.
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEMO_SEED !== "true") {
  throw new Error("db:reset is disabled unless ALLOW_DEMO_SEED=true and NODE_ENV is not production");
}
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query("drop schema if exists drizzle cascade; drop schema public cascade; create schema public;");
await client.end();
console.log("Development database wiped.");

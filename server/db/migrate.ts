import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, type DB } from "./client.js";

export const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

export async function runMigrations(db: DB) {
  await migrate(db, { migrationsFolder });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (copy .env.example to .env)");
  const db = createDb(url, 1);
  await runMigrations(db);
  console.log("Migrations applied.");
  await db.$client.end();
}

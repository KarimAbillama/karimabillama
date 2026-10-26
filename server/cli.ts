/**
 * Server management commands (run on the server by IT):
 *   edge migrate                      create/upgrade the database tables and reference data
 *   edge create-admin <email> <name>  create the first administrator (prints a temporary password)
 *   edge import <folder> [--dry-run]  load projects, companies, staff, items… from CSV templates
 *   edge reset-password <email>       give someone a new temporary password
 *   edge check                        check the database connection and show what is loaded
 * Reads DATABASE_URL (and ORG_NAME) from the environment / edge.env.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { baseSeed } from "./db/baseSeed.js";
import { roles, userRoles, users } from "./db/schema.js";
import { IMPORT_FILES, importMasters, resetPassword, tempPassword } from "./services/importMasters.js";
import { hashPassword } from "./auth/sessions.js";
import { businessToday } from "./lib/dates.js";

const [cmd, ...args] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set (see edge.env)."); process.exit(2); }
const db = createDb(url, 2);
const out = (s = "") => console.log(s);

async function main() {
  switch (cmd) {
    case "migrate": {
      await runMigrations(db);
      await baseSeed(db, process.env.ORG_NAME || "EDGE SCM Building Contracting");
      out("Database is up to date.");
      return 0;
    }
    case "create-admin": {
      const [email, ...name] = args;
      if (!email || !name.length) { out("Usage: edge create-admin <email> <full name>"); return 2; }
      const [existing] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
      if (existing) { out(`${email} already exists. Use reset-password if needed.`); return 1; }
      const pw = tempPassword();
      const [u] = await db.insert(users).values({ email: email.toLowerCase(), fullName: name.join(" "), jobTitle: "Administrator", passwordHash: await hashPassword(pw), mustChangePassword: true }).returning();
      for (const key of ["admin", "director"]) {
        const [r] = await db.select().from(roles).where(eq(roles.key, key));
        await db.insert(userRoles).values({ userId: u.id, roleId: r.id });
      }
      out(`Administrator created: ${u.email}`);
      out(`Temporary password:    ${pw}`);
      out("They will be asked to choose their own password at first sign-in.");
      return 0;
    }
    case "import": {
      const folder = args.find((a) => !a.startsWith("--"));
      const dryRun = args.includes("--dry-run");
      if (!folder || !existsSync(folder)) { out("Usage: edge import <folder with CSV files> [--dry-run]"); return 2; }
      const files = Object.fromEntries(IMPORT_FILES.filter((f) => existsSync(path.join(folder, `${f}.csv`))).map((f) => [f, readFileSync(path.join(folder, `${f}.csv`), "utf8")]));
      if (!Object.keys(files).length) { out(`No CSV files found in ${folder}. Expected: ${IMPORT_FILES.map((f) => `${f}.csv`).join(", ")}`); return 2; }
      out(`Reading: ${Object.keys(files).map((f) => `${f}.csv`).join(", ")}${dryRun ? " (dry run: nothing will be saved)" : ""}`);
      const res = await importMasters(db, files, { dryRun });
      for (const [f, c] of Object.entries(res.counts)) out(`  ${f.padEnd(17)} ${c.created} new, ${c.updated} updated`);
      if (res.problems.length) {
        out(`\nNothing was saved. Fix these ${res.problems.length} problem(s) and run again:`);
        for (const p of res.problems) out(`  - ${p}`);
        return 1;
      }
      if (dryRun) { out("\nEverything is valid. Run again without --dry-run to save."); return 0; }
      if (res.temporaryPasswords.length) {
        const file = path.join(folder, `temporary-passwords-${businessToday()}.csv`);
        writeFileSync(file, "email,full_name,temporary_password\n" + res.temporaryPasswords.map((p) => `${p.email},"${p.fullName.replace(/"/g, '""')}",${p.password}`).join("\n") + "\n");
        out(`\n${res.temporaryPasswords.length} new account(s). Temporary passwords saved to:\n  ${file}`);
        out("Give each person their password privately, then DELETE that file.");
      }
      out("\nImport saved.");
      return 0;
    }
    case "reset-password": {
      const r = args[0] ? await resetPassword(db, args[0]) : null;
      if (!r) { out(args[0] ? `No account for ${args[0]}.` : "Usage: edge reset-password <email>"); return 1; }
      out(`New temporary password for ${r.fullName} (${r.email}): ${r.password}`);
      return 0;
    }
    case "check": {
      const counts = await db.execute<Record<string, number>>(sql`select
        (select count(*)::int from projects) as projects, (select count(*)::int from users) as users,
        (select count(*)::int from companies) as companies, (select count(*)::int from items) as items,
        (select count(*)::int from rfis) as rfis, (select count(*)::int from submittals) as submittals,
        (select count(*)::int from site_reports) as site_reports`);
      out("Database connection OK.");
      for (const [k, v] of Object.entries(counts.rows[0])) out(`  ${k.padEnd(13)} ${v}`);
      return 0;
    }
    default:
      out("Commands: migrate | create-admin <email> <name> | import <folder> [--dry-run] | reset-password <email> | check");
      return cmd ? 2 : 0;
  }
}

main().then(async (code) => { await db.$client.end(); process.exit(code); }).catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await db.$client.end().catch(() => undefined);
  process.exit(1);
});

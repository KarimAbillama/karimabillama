/** Loading EDGE's own data from CSV templates, temporary passwords and changing them. */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { DB } from "../server/db/client.js";
import { itemUnitConversions, items, projectMembers, projects, submittalCodes, users } from "../server/db/schema.js";
import { buildApp, CSRF_HEADER } from "../server/app.js";
import { parseCsv, parseDate } from "../server/lib/csvRead.js";
import { importMasters, resetPassword, type ImportFile } from "../server/services/importMasters.js";
import { freshDb } from "./helpers.js";

let db: DB;
let app: FastifyInstance;
const example = path.join("deploy", "templates", "example");
const exampleFiles = () => Object.fromEntries(readdirSync(example).map((f) => [f.replace(/\.csv$/, ""), readFileSync(path.join(example, f), "utf8")])) as Partial<Record<ImportFile, string>>;

beforeAll(async () => {
  db = await freshDb();
  app = await buildApp(db, { sessionTtlHours: 1, cookieSecure: false, loginRateLimit: 1000 });
});

describe("CSV reading", () => {
  it("handles Excel files: byte-order mark, semicolons, quotes, UAE dates", () => {
    expect(parseCsv('﻿code;name\nA;"Block, 200"\n;\n')).toEqual([{ code: "A", name: "Block, 200" }]);
    expect(parseCsv('a,b\n"x ""y""","line1\nline2"\n')).toEqual([{ a: 'x "y"', b: "line1\nline2" }]);
    expect(parseDate("31/10/2026")).toBe("2026-10-31");
    expect(parseDate("2026-10-31")).toBe("2026-10-31");
    expect(parseDate("31/02/2026")).toBeNull();
  });
});

describe("importing master data", () => {
  it("a dry run checks everything and saves nothing", async () => {
    const res = await importMasters(db, exampleFiles(), { dryRun: true });
    expect(res).toMatchObject({ ok: true, problems: [], temporaryPasswords: [] });
    expect(await db.select().from(projects).where(eq(projects.code, "P-2601"))).toHaveLength(0);
  });

  it("lists every problem with file and row, and saves nothing if any row is wrong", async () => {
    const files = exampleFiles();
    files.users += "bad@example.ae,Bad Row,,superuser,P-9999,yes\n";
    files.items += "X-1,Thing,,boxes,,,\n";
    const res = await importMasters(db, files);
    expect(res.ok).toBe(false);
    expect(res.problems).toEqual(expect.arrayContaining([
      expect.stringMatching(/^users\.csv row 6: unknown role "superuser"/),
      expect.stringMatching(/^items\.csv row 5: base_unit "boxes" is not a known unit/),
    ]));
    expect(await db.select().from(users).where(eq(users.email, "pm1@example.ae"))).toHaveLength(0);
  });

  it("creates projects, people, items and codes; new people get a temporary password", async () => {
    const res = await importMasters(db, exampleFiles());
    expect(res.ok).toBe(true);
    expect(res.counts.projects).toEqual({ created: 1, updated: 0 });
    expect(res.temporaryPasswords.map((p) => p.email).sort()).toEqual(["dc@example.ae", "owner@example.ae", "pm1@example.ae", "se1@example.ae"]);
    const [p] = await db.select().from(projects).where(eq(projects.code, "P-2601"));
    expect(p).toMatchObject({ startDate: "2026-09-01", plannedEndDate: "2027-06-30", contractValue: "4500000.00", submittalReviewDays: 14, rfiResponseDays: 7 });
    const [pm] = await db.select().from(users).where(eq(users.email, "pm1@example.ae"));
    expect(pm.mustChangePassword).toBe(true);
    expect(await db.select().from(projectMembers).where(eq(projectMembers.userId, pm.id))).toHaveLength(1);
    const [tile] = await db.select().from(items).where(eq(items.code, "TIL-600"));
    expect((await db.select().from(itemUnitConversions).where(eq(itemUnitConversions.itemId, tile.id)))[0].baseUnitsPerUnit).toBe("1.4400000000");
    expect(await db.select().from(submittalCodes).where(eq(submittalCodes.projectId, p.id))).toHaveLength(4);
  });

  it("importing again updates instead of duplicating, and keeps passwords", async () => {
    const files = exampleFiles();
    files.projects = files.projects!.replace("Example Villa G+1 — Al Barsha", "Example Villa G+1 — Al Barsha (renamed)");
    const res = await importMasters(db, files);
    expect(res.counts.projects).toEqual({ created: 0, updated: 1 });
    expect(res.temporaryPasswords).toEqual([]);
    expect((await db.select().from(projects).where(eq(projects.code, "P-2601")))[0].name).toMatch(/renamed/);
  });
});

describe("temporary passwords", () => {
  const login = (email: string, password: string) => app.inject({ method: "POST", url: "/api/auth/login", headers: { [CSRF_HEADER]: "1" }, payload: { email, password } });
  const as = (cookie: string) => (method: "GET" | "POST", url: string, payload?: unknown) =>
    app.inject({ method, url, payload: payload as never, headers: { cookie: `edge_session=${cookie}`, [CSRF_HEADER]: "1" } });

  it("a person with a temporary password must set their own before using anything else", async () => {
    const reset = (await resetPassword(db, "se1@example.ae"))!;
    const res = await login("se1@example.ae", reset.password);
    expect(res.statusCode).toBe(200);
    expect(res.json().mustChangePassword).toBe(true);
    const cookie = res.cookies.find((c) => c.name === "edge_session")!.value;
    const call = as(cookie);
    expect((await call("GET", "/api/dashboard")).json().error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    // A second device signed in with the same account is signed out by the change.
    const other = as((await login("se1@example.ae", reset.password)).cookies.find((c) => c.name === "edge_session")!.value);

    expect((await call("POST", "/api/auth/password", { currentPassword: "wrong", newPassword: "a-much-longer-password" })).statusCode).toBe(422);
    expect((await call("POST", "/api/auth/password", { currentPassword: reset.password, newPassword: "short" })).json().error.message).toMatch(/10 characters/);
    expect((await call("POST", "/api/auth/password", { currentPassword: reset.password, newPassword: "se1@example.ae" })).json().error.message).toMatch(/email/);
    expect((await call("POST", "/api/auth/password", { currentPassword: reset.password, newPassword: "palm trees at the site gate" })).statusCode).toBe(200);

    expect((await call("GET", "/api/dashboard")).statusCode).toBe(200);
    expect((await call("GET", "/api/auth/me")).json().mustChangePassword).toBe(false);
    expect((await other("GET", "/api/auth/me")).statusCode).toBe(401);
    expect((await login("se1@example.ae", "palm trees at the site gate")).statusCode).toBe(200);
  });
});

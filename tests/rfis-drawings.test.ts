/** RFIs and the drawing register (acceptance scenarios 7 and 9). */
import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { DB } from "../server/db/client.js";
import { companies, projects } from "../server/db/schema.js";
import { addDays, businessToday } from "../server/lib/dates.js";
import * as rfi from "../server/services/rfis.js";
import * as dwg from "../server/services/drawings.js";
import { overview } from "../server/services/overview.js";
import { dashboard } from "../server/services/reports.js";
import { fixtures, freshDb, type Fx } from "./helpers.js";

let db: DB;
let fx: Fx;
let drawingId: string;
let revB: string;
const today = businessToday();

beforeAll(async () => {
  db = await freshDb();
  fx = await fixtures(db);
  const [consultant] = await db.insert(companies).values({ code: "CN-R", name: "RFI Consultant", isConsultant: true }).returning();
  await db.update(projects).set({ consultantCompanyId: consultant.id, rfiResponseDays: 7 }).where(eq(projects.id, fx.projA.id));
  const d = await dwg.createDrawing(db, fx.actors.pmA, {
    projectId: fx.projA.id, number: "A-201", title: "Level 2 floor plan", discipline: "architectural",
    firstRevision: { revision: "A", issueDate: addDays(today, -40), purpose: "for_approval", fileRef: "\\\\server\\drawings\\A-201_A.pdf" },
  });
  drawingId = d.id;
  revB = (await dwg.addRevision(db, fx.actors.pmA, d.id, { revision: "B", issueDate: addDays(today, -30), purpose: "for_construction", distribution: "Site team, MEP subcontractor" })).id;
});

const newRfi = (extra: Partial<rfi.RfiInput> = {}) => rfi.createRfi(db, fx.actors.engineerA, {
  projectId: fx.projA.id, discipline: "architectural", subject: "Door D-12 head height", question: "Drawing shows 2100 mm; the schedule says 2400 mm. Which applies?",
  location: "Level 2, corridor", drawingRevisionId: revB, ...extra,
});

describe("drawing register (scenario 9)", () => {
  it("keeps every revision, marks the newest construction issue as current and older ones as superseded", async () => {
    await dwg.addRevision(db, fx.actors.pmA, drawingId, { revision: "C", issueDate: addDays(today, -5), purpose: "for_construction", fileRef: "\\\\server\\drawings\\A-201_C.pdf" });
    const d = await dwg.getDrawing(db, fx.actors.engineerA, drawingId);
    expect(d.revisions.map((r) => [r.revision, r.state])).toEqual([["C", "current_construction"], ["B", "superseded"], ["A", "superseded"]]);
    expect(d.revisions.find((r) => r.revision === "A")!.fileRef).toContain("A-201_A.pdf"); // the old file reference is preserved
    const list = await dwg.listDrawings(db, fx.actors.engineerA, { projectId: fx.projA.id });
    expect(list[0].construction?.revision).toBe("C");
  });

  it("a newer revision issued only for approval does not replace the construction revision", async () => {
    await dwg.addRevision(db, fx.actors.pmA, drawingId, { revision: "D", issueDate: addDays(today, -1), purpose: "for_approval" });
    const d = await dwg.getDrawing(db, fx.actors.pmA, drawingId);
    expect(d.revisions.map((r) => [r.revision, r.state]).slice(0, 2)).toEqual([["D", "latest"], ["C", "current_construction"]]);
  });

  it("revisions cannot be edited, duplicated, or registered by site engineers", async () => {
    await expect(db.execute(sql`update drawing_revisions set revision = 'Z' where id = ${revB}`)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) } });
    await expect(dwg.addRevision(db, fx.actors.pmA, drawingId, { revision: "C", issueDate: today, purpose: "for_construction" })).rejects.toMatchObject({ code: "REVISION_EXISTS" });
    await expect(dwg.addRevision(db, fx.actors.engineerA, drawingId, { revision: "E", issueDate: today, purpose: "for_construction" })).rejects.toMatchObject({ status: 403 });
    await expect(dwg.getDrawing(db, fx.actors.engineerB, drawingId)).rejects.toMatchObject({ status: 404 });
  });
});

describe("RFIs (scenario 7)", () => {
  it("warns when the RFI points to a superseded drawing revision", async () => {
    const r = await newRfi();
    expect(r.warnings[0]).toMatch(/A-201 revision B is superseded\. Current: C/);
    expect((await rfi.getRfi(db, fx.actors.engineerA, r.id)).drawingWarning).toMatch(/superseded/);
  });

  it("goes draft → internal review → returned → review → issued → responded → closed, recording every step", async () => {
    const r = await newRfi({ blockedActivity: "Door frame installation L2", costImpact: "possible" });
    await rfi.sendForReview(db, fx.actors.engineerA, r.id);
    await expect(rfi.returnRfi(db, fx.actors.pmA, r.id, "")).rejects.toMatchObject({ code: "COMMENT_REQUIRED" });
    await rfi.returnRfi(db, fx.actors.pmA, r.id, "Add the door schedule reference");
    const back = await rfi.getRfi(db, fx.actors.engineerA, r.id);
    await rfi.updateRfi(db, fx.actors.engineerA, r.id, { ...back, question: `${back.question} (door schedule DS-02)`, version: back.version });
    await rfi.sendForReview(db, fx.actors.engineerA, r.id);
    await expect(rfi.issueRfi(db, fx.actors.engineerA, r.id, { issueDate: today })).rejects.toMatchObject({ status: 403 });
    const issued = await rfi.issueRfi(db, fx.actors.pmA, r.id, { issueDate: addDays(today, -2), transmittalRef: "TR-0101" });
    expect(issued).toEqual({ round: 1, responseDueDate: addDays(today, 5) }); // project gives the consultant 7 days

    await rfi.recordRfiResponse(db, fx.actors.pmA, r.id, { responseDate: today, response: "2400 mm applies. Revised door schedule to follow.", responderName: "Consultant RE" });
    let d = await rfi.getRfi(db, fx.actors.pmA, r.id);
    // The response is recorded but the RFI is NOT closed and NOT turned into a variation.
    expect(d.status).toBe("responded");
    expect(d.ballInCourt).toBe("edge");
    expect(d.potentialVariation).toBe(true);
    await expect(rfi.closeRfi(db, fx.actors.pmA, r.id, { closedDate: today, closureNote: " " })).rejects.toMatchObject({ code: "NOTE_REQUIRED" });
    expect(await rfi.closeRfi(db, fx.actors.pmA, r.id, { closedDate: today, closureNote: "Frames ordered at 2400 mm; QS to assess cost" })).toEqual({ potentialVariation: true });
    d = await rfi.getRfi(db, fx.actors.engineerA, r.id);
    expect(d.status).toBe("closed");
    expect(d.events.map((e) => e.toStatus)).toEqual(["draft", "internal_review", "returned", "internal_review", "issued", "responded", "closed"]);
    expect(d.responses).toHaveLength(1);
    await expect(db.execute(sql`delete from rfi_events where rfi_id = ${r.id}`)).rejects.toThrow();
  });

  it("shows an overdue RFI with its owner and the work it holds up, on the dashboard and the overview", async () => {
    const r = await newRfi({ subject: "Slab edge detail at balcony", blockedActivity: "Balcony formwork L3", drawingRevisionId: null });
    await rfi.issueRfi(db, fx.actors.pmA, r.id, { issueDate: addDays(today, -20) }); // due 7 days later → 13 days late
    const d = await rfi.getRfi(db, fx.actors.engineerA, r.id);
    expect(d).toMatchObject({ overdue: true, daysOverdue: 13, ballInCourt: "consultant", owner: "RFI Consultant", blockedActivity: "Balcony formwork L3" });
    const dash = await dashboard(db, fx.actors.pmA);
    expect(dash.actions.find((a) => a.kind === "rfi_overdue" && a.link === `/rfis/${r.id}`)?.detail).toContain("Balcony formwork L3");
    const o = await overview(db, fx.actors.director);
    const a = o.projects.find((p) => p.project.id === fx.projA.id)!;
    expect(a.rfis).toMatchObject({ overdue: 1, blocking: 1, rag: "red" });
    expect(a.attention.some((t) => t.includes("RFI(s) overdue"))).toBe(true);
  });

  it("an incomplete answer can be re-issued as a new round, with a reason", async () => {
    const r = await newRfi({ subject: "Ceiling void depth", drawingRevisionId: null });
    await rfi.issueRfi(db, fx.actors.pmA, r.id, { issueDate: addDays(today, -6) });
    await rfi.recordRfiResponse(db, fx.actors.pmA, r.id, { responseDate: addDays(today, -1), response: "Refer to MEP drawings." });
    await expect(rfi.issueRfi(db, fx.actors.pmA, r.id, { issueDate: today })).rejects.toMatchObject({ code: "NOTE_REQUIRED" });
    expect((await rfi.issueRfi(db, fx.actors.pmA, r.id, { issueDate: today, note: "MEP drawings do not show the void depth" })).round).toBe(2);
  });

  it("is invisible to other projects and to people without RFI access", async () => {
    const r = await newRfi({ drawingRevisionId: null });
    await expect(rfi.getRfi(db, fx.actors.engineerB, r.id)).rejects.toMatchObject({ status: 404 });
    expect((await rfi.listRfis(db, fx.actors.pmB, {})).length).toBe(0);
    await expect(rfi.listRfis(db, fx.actors.store, {})).rejects.toMatchObject({ status: 403 });
  });
});

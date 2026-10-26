/**
 * In-browser stand-in for the API, used only by the clickable preview (`npm run build:preview`).
 * It lets the real web screens run inside a single web page with no server or database.
 *
 * This is NOT the business logic of the system. It follows the rules of `server/services/*` closely
 * enough for a demo (approvals, reservations, partial receipts, issues, transfers, the report),
 * but the tested implementation is the server. Data is invented and lives only in memory.
 */
import Decimal from "decimal.js";
import { ROLE_TEMPLATES } from "../server/auth/roles";
import { VAT_CODES, VAT_VERIFIED } from "../server/lib/vat";

// ───────────── helpers ─────────────
type Num = number;
const D = (v: Decimal.Value) => new Decimal(v);
const plus = (...v: Decimal.Value[]) => v.reduce<Decimal>((a, b) => a.plus(b), D(0)).toDecimalPlaces(4).toNumber();
const minus = (a: Decimal.Value, b: Decimal.Value) => D(a).minus(b).toDecimalPlaces(4).toNumber();
const times = (a: Decimal.Value, b: Decimal.Value, dp = 4) => D(a).times(b).toDecimalPlaces(dp).toNumber();
const q4 = (v: Decimal.Value) => D(v).toDecimalPlaces(4).toFixed(4);
const m2 = (v: Decimal.Value) => D(v).toDecimalPlaces(2).toFixed(2);
const sum = (v: Decimal.Value[]) => plus(...v);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nowIso = () => new Date().toISOString();
const qtyText = (v: Num) => D(v).toDecimalPlaces(4).toString();

class HttpError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
const notFound = (what: string) => new HttpError(404, "NOT_FOUND", `${what} not found`);
const forbidden = () => new HttpError(403, "FORBIDDEN", "You do not have permission to do this.");
const rule = (code: string, message: string) => new HttpError(422, code, message);
const conflict = () => new HttpError(409, "VERSION_CONFLICT", "Someone else changed this record. Reload and try again.");

let idSeq = 0;
const newId = (p: string) => `${p}${++idSeq}`;
const seqs = new Map<string, number>();
const nextNumber = (prefix: string) => {
  const year = today().slice(0, 4);
  const k = `${prefix}-${year}`;
  const n = (seqs.get(k) ?? 0) + 1;
  seqs.set(k, n);
  return `${k}-${String(n).padStart(5, "0")}`;
};

// ───────────── data ─────────────
interface User { id: string; email: string; fullName: string; jobTitle: string; roles: string[]; projects: string[]; lastLoginAt: string | null }
interface Item { id: string; code: string; description: string; category: string; baseUnit: string; purchaseUnit: string | null; reorderLevel: Num | null; conversions: { unitCode: string; factor: Num }[] }
interface Location { id: string; code: string; name: string; type: "warehouse" | "site_store" | "transit"; projectId: string | null }
interface MrLine { id: string; lineNo: number; itemId: string; qty: Num; costCodeId: string; remarks: string | null }
interface Mr { id: string; number: string; projectId: string; siteId: string | null; requiredDate: string; purpose: string | null; status: string; revision: number; version: number; requestedBy: string; createdAt: string; lines: MrLine[] }
interface PoLine { id: string; lineNo: number; itemId: string; mrLineId: string | null; costCodeId: string; unitCode: string; qty: Num; qtyBase: Num; unitPrice: Num; vatCode: string; lineNet: Num; lineVat: Num; cancelledBase: Num }
interface Po { id: string; number: string; projectId: string; supplierId: string; deliveryLocationId: string; requiredDate: string | null; promisedDate: string | null; paymentTerms: string | null; supplierQuoteRef: string | null; notes: string | null; status: string; revision: number; version: number; createdBy: string; approvedAt: string | null; lines: PoLine[] }
interface Step { id: string; stepNo: number; roleKey: string; status: string; decidedBy: string | null; decidedAt: string | null; comment: string | null }
interface Approval { id: string; docType: "material_request" | "purchase_order"; docId: string; docRevision: number; status: string; requestedAt: string; requestedBy: string; amount: Num | null; steps: Step[] }
interface Receipt { id: string; number: string; poId: string; projectId: string; locationId: string; receivedDate: string; deliveryNoteRef: string | null; receivedBy: string; idem: string; lines: { poLineId: string; itemId: string; accepted: Num; rejected: Num; reason: string | null; unitCostBase: Num }[] }
interface Reservation { id: string; mrLineId: string; locationId: string; itemId: string; qty: Num; consumed: Num; status: "active" | "consumed" | "released"; source: string }
interface Movement { seq: number; date: string; type: string; itemId: string; locationId: string; status: string; qty: Num; sourceType: string; sourceId: string; sourceNumber: string; projectId: string | null; costCodeId: string | null; postedBy: string; note: string | null; unitCost: Num | null; value: Num | null }
interface Transfer { id: string; number: string; fromId: string; toId: string; status: string; dispatchDate: string; receivedDate: string | null; vehicleRef: string | null; notes: string | null; dispatchedBy: string; idem: string; lines: { id: string; itemId: string; qty: Num; mrLineId: string | null; received: Num | null; short: Num | null; discStatus: string; note: string | null }[] }
interface Issue { id: string; number: string; idem: string }
interface Project { id: string; code: string; name: string; status: string; contractValue: Num; clientName: string; startDate: string; plannedEndDate: string; consultantId: string | null; reviewDays: number }
interface Partner { id: string; name: string; isSubcontractor: boolean; isConsultant: boolean }
interface SubCode { id: string; projectId: string; code: string; label: string; outcome: string; sortOrder: number }
interface Submittal { id: string; number: string; projectId: string; type: string; title: string; discipline: string; specSection: string | null; area: string | null; subcontractorId: string | null; consultantId: string | null; requiredBy: string | null; status: string; currentRevision: number; version: number; createdBy: string; createdAt: string; itemIds: string[] }
interface SubRev { id: string; submittalId: string; revNo: number; submittedDate: string; dueDate: string; transmittalRef: string | null; notes: string | null; submittedBy: string; returnedDate: string | null; codeId: string | null; outcome: string | null; consultantComments: string | null; reviewerName: string | null; inspectionDate: string | null; recordedBy: string | null }
interface SiteReport { id: string; projectId: string; siteId: string | null; reportDate: string; status: string; weather: string | null; workDone: string; issues: string | null; delayCause: string | null; inspections: string | null; visitors: string | null; safetyIncidents: number; safetyNotes: string | null; createdBy: string; submittedAt: string | null; reviewedBy: string | null; reviewedAt: string | null; reviewComment: string | null; version: number; manpower: { id: string; trade: string; companyId: string | null; headcount: number }[] }
interface Progress { id: string; projectId: string; asOfDate: string; plannedPct: Num; actualPct: Num; forecastEndDate: string | null; summary: string | null; risks: string | null; createdBy: string; createdAt: string }
interface Audit { id: number; at: string; userId: string | null; action: string; entityType: string; entityId: string | null; projectId: string | null; details: Record<string, unknown> | null }

const db = {
  users: [] as User[], projects: [] as Project[],
  sites: [] as { id: string; projectId: string; code: string; name: string }[], locations: [] as Location[], items: [] as Item[],
  suppliers: [] as { id: string; code: string; name: string; trn: string | null; paymentTerms: string | null }[],
  costCodes: [] as { id: string; code: string; name: string; category: string }[],
  mrs: [] as Mr[], pos: [] as Po[], approvals: [] as Approval[], receipts: [] as Receipt[], reservations: [] as Reservation[],
  movements: [] as Movement[], balances: new Map<string, Num>(), valuations: new Map<string, { avg: Num; qty: Num }>(),
  transfers: [] as Transfer[], issues: [] as Issue[], audit: [] as Audit[],
  partners: [] as Partner[], codes: [] as SubCode[], submittals: [] as Submittal[], revisions: [] as SubRev[], siteReports: [] as SiteReport[], progress: [] as Progress[],
};
let session: string | null = null;

// ───────────── actor & scope ─────────────
interface Actor { user: User; perms: Set<string>; all: boolean }
const actorOf = (u: User): Actor => {
  const t = ROLE_TEMPLATES.filter((r) => u.roles.includes(r.key));
  return { user: u, perms: new Set(t.flatMap((r) => r.permissions)), all: t.some((r) => r.allProjects) };
};
const can = (a: Actor, p: string) => a.perms.has(p);
const need = (a: Actor, ...p: string[]) => { if (!p.every((x) => can(a, x))) throw forbidden(); };
const inScope = (a: Actor, projectId: string | null) => !projectId || a.all || a.user.projects.includes(projectId);
const needProject = (a: Actor, projectId: string, what: string) => { if (!inScope(a, projectId)) throw notFound(what); };
const visibleLocations = (a: Actor) => db.locations.filter((l) => l.type !== "site_store" || inScope(a, l.projectId));
const needLocation = (a: Actor, id: string) => { const l = visibleLocations(a).find((x) => x.id === id); if (!l) throw notFound("Location"); return l; };

const byId = <T extends { id: string }>(arr: T[], id: string, what: string) => { const x = arr.find((r) => r.id === id); if (!x) throw notFound(what); return x; };
const userName = (id: string | null) => db.users.find((u) => u.id === id)?.fullName ?? null;
const item = (id: string) => db.items.find((i) => i.id === id)!;
const loc = (id: string) => db.locations.find((l) => l.id === id)!;
const cc = (id: string) => db.costCodes.find((c) => c.id === id)!;
const project = (id: string) => db.projects.find((p) => p.id === id)!;
const transit = () => db.locations.find((l) => l.type === "transit")!;
const audit = (a: Actor | null, action: string, entityType: string, entityId: string | null, projectId: string | null, details: Record<string, unknown> | null = null) =>
  db.audit.push({ id: db.audit.length + 1, at: nowIso(), userId: a?.user.id ?? null, action, entityType, entityId, projectId, details });

// ───────────── stock ledger ─────────────
const bkey = (itemId: string, locationId: string, status: string) => `${itemId}|${locationId}|${status}`;
const bal = (itemId: string, locationId: string, status = "available") => db.balances.get(bkey(itemId, locationId, status)) ?? 0;
let moveSeq = 0;
function post(a: Actor, m: Omit<Movement, "seq" | "postedBy">) {
  const k = bkey(m.itemId, m.locationId, m.status);
  const next = plus(db.balances.get(k) ?? 0, m.qty);
  if (next < 0) throw rule("INSUFFICIENT_STOCK", `Not enough ${item(m.itemId).code} at ${loc(m.locationId).code}.`);
  db.balances.set(k, next);
  db.movements.push({ ...m, seq: ++moveSeq, postedBy: a.user.id });
}
const valuation = (itemId: string) => db.valuations.get(itemId) ?? { avg: 0, qty: 0 };
function valueIn(itemId: string, qty: Num, unitCost: Num) {
  const v = valuation(itemId);
  const newQty = plus(v.qty, qty);
  const avg = newQty > 0 ? D(v.avg).times(v.qty).plus(D(unitCost).times(qty)).dividedBy(newQty).toDecimalPlaces(4).toNumber() : unitCost;
  db.valuations.set(itemId, { avg, qty: newQty });
}
function valueOut(itemId: string, qty: Num) {
  const v = valuation(itemId);
  db.valuations.set(itemId, { avg: v.avg, qty: Math.max(0, minus(v.qty, qty)) });
  return { unitCost: v.avg, value: times(v.avg, qty, 2) };
}
const reservedAt = (itemId: string, locationId: string) =>
  sum(db.reservations.filter((r) => r.status === "active" && r.itemId === itemId && r.locationId === locationId).map((r) => minus(r.qty, r.consumed)));
const freeAt = (itemId: string, locationId: string) => minus(bal(itemId, locationId), reservedAt(itemId, locationId));
function consume(r: Reservation, qty: Num) {
  r.consumed = plus(r.consumed, qty);
  if (r.consumed >= r.qty) r.status = "consumed";
}

// ───────────── material requests ─────────────
const mrLine = (lineId: string) => {
  for (const m of db.mrs) { const l = m.lines.find((x) => x.id === lineId); if (l) return { mr: m, line: l }; }
  throw notFound("Material request line");
};
const poLineAccepted = (poLineId: string) => sum(db.receipts.flatMap((g) => g.lines).filter((l) => l.poLineId === poLineId).map((l) => l.accepted));
const poLineRejected = (poLineId: string) => sum(db.receipts.flatMap((g) => g.lines).filter((l) => l.poLineId === poLineId).map((l) => l.rejected));
function fulfilment(lineId: string) {
  const { line } = mrLine(lineId);
  const issued = sum(db.movements.filter((m) => m.type === "issue" && m.sourceType === "stock_issue" && (m as Movement & { mrLineId?: string }).mrLineId === lineId).map((m) => -m.qty));
  const reserved = sum(db.reservations.filter((r) => r.mrLineId === lineId && r.status === "active").map((r) => minus(r.qty, r.consumed)));
  const onOrder = sum(db.pos.filter((p) => !["cancelled", "rejected", "closed"].includes(p.status)).flatMap((p) => p.lines)
    .filter((l) => l.mrLineId === lineId).map((l) => minus(minus(l.qtyBase, l.cancelledBase), poLineAccepted(l.id))));
  const inTransit = sum(db.transfers.filter((t) => t.status === "in_transit").flatMap((t) => t.lines).filter((l) => l.mrLineId === lineId).map((l) => l.qty));
  const uncovered = Math.max(0, minus(minus(minus(minus(line.qty, issued), reserved), onOrder), inTransit));
  return { requested: line.qty, issued, reserved, onOrder, inTransit, uncovered };
}
const fulfilmentOut = (f: ReturnType<typeof fulfilment>) =>
  ({ requested: q4(f.requested), issued: q4(f.issued), reserved: q4(f.reserved), onOrder: q4(f.onOrder), inTransit: q4(f.inTransit), uncovered: q4(f.uncovered) });

function validateMrLines(lines: { itemId: string; qty: string | number; costCodeId: string; remarks?: string | null }[]) {
  if (!lines?.length) throw rule("NO_LINES", "Add at least one item.");
  return lines.map((l, i) => {
    if (!l.itemId) throw rule("VALIDATION", `Line ${i + 1}: choose an item.`);
    if (!l.costCodeId) throw rule("VALIDATION", `Line ${i + 1}: choose a cost code.`);
    const qty = Number(l.qty);
    if (!(qty > 0)) throw rule("VALIDATION", `Line ${i + 1}: quantity must be more than zero.`);
    return { id: newId("mrl"), lineNo: i + 1, itemId: l.itemId, qty: D(qty).toDecimalPlaces(4).toNumber(), costCodeId: l.costCodeId, remarks: l.remarks || null };
  });
}
function createMr(a: Actor, b: { projectId: string; siteId?: string | null; requiredDate: string; purpose?: string | null; lines: { itemId: string; qty: string | number; costCodeId: string; remarks?: string | null }[] }) {
  need(a, "mr.create");
  needProject(a, b.projectId, "Project");
  const mr: Mr = { id: newId("mr"), number: nextNumber("MR"), projectId: b.projectId, siteId: b.siteId || null, requiredDate: b.requiredDate, purpose: b.purpose || null,
    status: "draft", revision: 0, version: 1, requestedBy: a.user.id, createdAt: nowIso(), lines: validateMrLines(b.lines) };
  db.mrs.push(mr);
  audit(a, "mr.create", "material_request", mr.id, mr.projectId, { number: mr.number });
  return mr;
}
const getMrFor = (a: Actor, id: string) => { need(a, "mr.view"); const m = byId(db.mrs, id, "Material request"); needProject(a, m.projectId, "Material request"); return m; };
function submitMr(a: Actor, id: string, version?: number) {
  const m = getMrFor(a, id);
  need(a, "mr.create");
  if (m.status !== "draft") throw rule("INVALID_STATE", "Only a draft can be submitted.");
  if (version !== undefined && version !== m.version) throw conflict();
  m.status = "pending_approval"; m.version++;
  startApproval("material_request", m.id, m.revision, a.user.id, null);
  audit(a, "mr.submit", "material_request", m.id, m.projectId, { number: m.number });
}
function cancelMr(a: Actor, id: string, reason: string) {
  const m = getMrFor(a, id);
  need(a, "mr.create");
  if (!reason) throw rule("REASON_REQUIRED", "A reason is required.");
  if (m.lines.some((l) => { const f = fulfilment(l.id); return f.issued > 0 || f.onOrder > 0 || f.inTransit > 0; }))
    throw rule("IN_USE", "Material has already been ordered, issued or dispatched for this request, so it cannot be cancelled.");
  for (const r of db.reservations) if (m.lines.some((l) => l.id === r.mrLineId) && r.status === "active") r.status = "released";
  supersede("material_request", m.id);
  m.status = "cancelled"; m.version++;
  audit(a, "mr.cancel", "material_request", m.id, m.projectId, { number: m.number, reason });
}
function reserve(a: Actor, lineId: string, locationId: string, qtyIn: string | number) {
  need(a, "mr.allocate");
  const { mr, line } = mrLine(lineId);
  needProject(a, mr.projectId, "Material request");
  needLocation(a, locationId);
  if (mr.status !== "approved") throw rule("INVALID_STATE", "Only approved requests can reserve stock.");
  const qty = Number(qtyIn);
  if (!(qty > 0)) throw rule("VALIDATION", "Quantity must be more than zero.");
  if (qty > fulfilment(lineId).uncovered) throw rule("OVER_RESERVE", "That is more than this line still needs.");
  if (qty > freeAt(line.itemId, locationId)) throw rule("INSUFFICIENT_STOCK", "Not enough free stock at that location.");
  db.reservations.push({ id: newId("res"), mrLineId: lineId, locationId, itemId: line.itemId, qty, consumed: 0, status: "active", source: "manual" });
  audit(a, "mr.reserve", "material_request", mr.id, mr.projectId, { line: line.lineNo, location: loc(locationId).code, qty });
}

// ───────────── approvals ─────────────
function stepsFor(docType: Approval["docType"], amount: Num | null) {
  if (docType === "material_request") return ["project_manager"];
  if ((amount ?? 0) <= 25000) return ["project_manager"];
  if ((amount ?? 0) <= 100000) return ["project_manager", "operations_manager"];
  return ["project_manager", "operations_manager", "director"];
}
function startApproval(docType: Approval["docType"], docId: string, docRevision: number, requestedBy: string, amount: Num | null) {
  const roles = stepsFor(docType, amount);
  db.approvals.push({ id: newId("apr"), docType, docId, docRevision, status: "pending", requestedAt: nowIso(), requestedBy, amount,
    steps: roles.map((r, i) => ({ id: newId("stp"), stepNo: i + 1, roleKey: r, status: i === 0 ? "pending" : "waiting", decidedBy: null, decidedAt: null, comment: null })) });
}
function supersede(docType: string, docId: string) {
  for (const r of db.approvals) if (r.docType === docType && r.docId === docId && r.status === "pending") r.status = "superseded";
}
const docOf = (r: Approval) => (r.docType === "material_request" ? db.mrs.find((m) => m.id === r.docId)! : db.pos.find((p) => p.id === r.docId)!);
function eligible(a: Actor, r: Approval) {
  if (r.status !== "pending") return null;
  const step = r.steps.find((s) => s.status === "pending");
  if (!step) return null;
  const doc = docOf(r);
  if (!a.user.roles.includes(step.roleKey)) return null;
  if (!can(a, r.docType === "material_request" ? "mr.approve" : "po.approve")) return null;
  if (!inScope(a, doc.projectId)) return null;
  if (r.requestedBy === a.user.id) return null;
  if (r.steps.some((s) => s.decidedBy === a.user.id)) return null;
  return step;
}
function myPending(a: Actor) {
  return db.approvals.flatMap((r) => {
    const step = eligible(a, r);
    if (!step) return [];
    const doc = docOf(r);
    return [{ requestId: r.id, docType: r.docType, docId: r.docId, docNumber: doc.number, projectCode: project(doc.projectId).code,
      amount: r.amount === null || !can(a, "rates.view") ? null : m2(r.amount), requesterName: userName(r.requestedBy) ?? "", stepNo: step.stepNo, roleKey: step.roleKey, requestedAt: r.requestedAt }];
  });
}
function decide(a: Actor, requestId: string, decision: "approve" | "reject", comment?: string | null) {
  const r = byId(db.approvals, requestId, "Approval request");
  const step = eligible(a, r);
  if (!step) throw rule("NOT_YOUR_STEP", "This approval is not waiting for you. You cannot approve your own request or approve two steps.");
  if (decision === "reject" && !comment?.trim()) throw rule("COMMENT_REQUIRED", "A comment is required to reject.");
  Object.assign(step, { status: decision === "approve" ? "approved" : "rejected", decidedBy: a.user.id, decidedAt: nowIso(), comment: comment || null });
  const doc = docOf(r);
  if (decision === "reject") { r.status = "rejected"; doc.status = "rejected"; }
  else {
    const next = r.steps.find((s) => s.status === "waiting");
    if (next) next.status = "pending";
    else { r.status = "approved"; doc.status = "approved"; if ("approvedAt" in doc) doc.approvedAt = nowIso(); }
  }
  doc.version++;
  audit(a, `approval.${decision}`, r.docType, doc.id, doc.projectId, { number: doc.number, step: step.stepNo });
}
const approvalsOut = (docType: string, docId: string) => db.approvals.filter((r) => r.docType === docType && r.docId === docId).map((r) => ({
  id: r.id, docRevision: r.docRevision, status: r.status, requestedAt: r.requestedAt, amount: r.amount === null ? null : m2(r.amount),
  steps: r.steps.map((s) => ({ ...s, deciderName: userName(s.decidedBy), docRevision: r.docRevision })),
}));

// ───────────── purchasing ─────────────
const factorOf = (it: Item, unitCode: string) => {
  if (unitCode === it.baseUnit) return 1;
  const c = it.conversions.find((x) => x.unitCode === unitCode);
  if (!c) throw rule("UNIT", `${unitCode} is not a valid unit for ${it.code}.`);
  return c.factor;
};
type PoLineIn = { itemId: string; mrLineId?: string | null; costCodeId: string; unitCode: string; qty: string | number; unitPrice: string | number; vatCode: string };
type PoIn = { projectId?: string; supplierId: string; deliveryLocationId: string; requiredDate?: string | null; promisedDate?: string | null; paymentTerms?: string | null; supplierQuoteRef?: string | null; notes?: string | null; lines: PoLineIn[] };
function poLines(a: Actor, projectId: string, lines: PoLineIn[], excludePoId?: string) {
  if (!lines?.length) throw rule("NO_LINES", "Add at least one line.");
  return lines.map((l, i) => {
    if (!l.itemId) throw rule("VALIDATION", `Line ${i + 1}: choose an item.`);
    if (!l.costCodeId) throw rule("VALIDATION", `Line ${i + 1}: choose a cost code.`);
    const it = item(l.itemId);
    const qty = Number(l.qty), price = Number(l.unitPrice);
    if (!(qty > 0)) throw rule("VALIDATION", `Line ${i + 1}: quantity must be more than zero.`);
    if (!(price >= 0) || l.unitPrice === "") throw rule("VALIDATION", `Line ${i + 1}: enter a unit price.`);
    const qtyBase = times(qty, factorOf(it, l.unitCode || it.baseUnit));
    if (l.mrLineId) {
      const { mr } = mrLine(l.mrLineId);
      if (mr.projectId !== projectId || mr.status !== "approved") throw rule("MR_NOT_APPROVED", "The linked request must be approved and on the same project.");
      const f = fulfilment(l.mrLineId);
      const ownOnOrder = excludePoId ? sum(byId(db.pos, excludePoId, "PO").lines.filter((x) => x.mrLineId === l.mrLineId).map((x) => x.qtyBase)) : 0;
      if (qtyBase > plus(f.uncovered, ownOnOrder)) throw rule("OVER_ORDER", `Line ${i + 1}: that is more than the request still needs (${qtyText(plus(f.uncovered, ownOnOrder))} ${it.baseUnit}).`);
    }
    const rate = Number(VAT_CODES[l.vatCode as keyof typeof VAT_CODES]?.rate ?? 0);
    const lineNet = times(qty, price, 2);
    void a;
    return { id: newId("pol"), lineNo: i + 1, itemId: l.itemId, mrLineId: l.mrLineId || null, costCodeId: l.costCodeId, unitCode: l.unitCode || it.baseUnit, qty, qtyBase, unitPrice: price,
      vatCode: l.vatCode, lineNet, lineVat: D(lineNet).times(rate).dividedBy(100).toDecimalPlaces(2).toNumber(), cancelledBase: 0 };
  });
}
function createPo(a: Actor, b: PoIn & { projectId: string }) {
  need(a, "po.create");
  needProject(a, b.projectId, "Project");
  if (!b.supplierId) throw rule("VALIDATION", "Choose a supplier.");
  if (!b.deliveryLocationId) throw rule("VALIDATION", "Choose where to deliver.");
  const po: Po = { id: newId("po"), number: nextNumber("PO"), projectId: b.projectId, supplierId: b.supplierId, deliveryLocationId: b.deliveryLocationId,
    requiredDate: b.requiredDate || null, promisedDate: b.promisedDate || null, paymentTerms: b.paymentTerms || null, supplierQuoteRef: b.supplierQuoteRef || null, notes: b.notes || null,
    status: "draft", revision: 0, version: 1, createdBy: a.user.id, approvedAt: null, lines: poLines(a, b.projectId, b.lines) };
  db.pos.push(po);
  audit(a, "po.create", "purchase_order", po.id, po.projectId, { number: po.number });
  return po;
}
const subtotal = (p: Po) => sum(p.lines.map((l) => l.lineNet));
const getPoFor = (a: Actor, id: string) => { need(a, "po.view"); const p = byId(db.pos, id, "Purchase order"); needProject(a, p.projectId, "Purchase order"); return p; };
function submitPo(a: Actor, id: string, version?: number) {
  const p = getPoFor(a, id);
  need(a, "po.create");
  if (p.status !== "draft") throw rule("INVALID_STATE", "Only a draft can be submitted.");
  if (version !== undefined && version !== p.version) throw conflict();
  const blocked = blockingSubmittals(p.projectId, [...new Set(p.lines.map((l) => l.itemId))]);
  if (blocked.length) throw rule("SUBMITTAL_NOT_APPROVED", `Not approved by the consultant yet: ${blocked.map((b) => `${b.itemCode} (${b.numbers.join(", ")})`).join("; ")}. Order once the submittal is approved.`);
  p.status = "pending_approval"; p.version++;
  startApproval("purchase_order", p.id, p.revision, a.user.id, subtotal(p));
  audit(a, "po.submit", "purchase_order", p.id, p.projectId, { number: p.number, subtotal: m2(subtotal(p)) });
}
function receive(a: Actor, poId: string, b: { idempotencyKey: string; deliveryNoteRef?: string | null; receivedDate: string; lines: { poLineId: string; qtyReceived: string; qtyRejected?: string; rejectionReason?: string | null }[] }) {
  need(a, "stock.receive");
  const p = getPoFor(a, poId);
  needLocation(a, p.deliveryLocationId);
  const dup = db.receipts.find((g) => g.idem === b.idempotencyKey);
  if (dup) return dup;
  if (!["approved", "partially_received"].includes(p.status)) throw rule("INVALID_STATE", "Only approved purchase orders can be received.");
  if (!b.lines?.length) throw rule("NO_LINES", "Enter the delivered quantity for at least one line.");
  if (b.receivedDate > today()) throw rule("FUTURE_DATE", "The receipt date cannot be in the future.");
  const g: Receipt = { id: newId("grn"), number: nextNumber("GRN"), poId: p.id, projectId: p.projectId, locationId: p.deliveryLocationId, receivedDate: b.receivedDate,
    deliveryNoteRef: b.deliveryNoteRef || null, receivedBy: a.user.id, idem: b.idempotencyKey, lines: [] };
  for (const l of b.lines) {
    const pl = p.lines.find((x) => x.id === l.poLineId);
    if (!pl) throw notFound("PO line");
    const factor = pl.qtyBase / pl.qty;
    const rec = times(Number(l.qtyReceived), factor), rej = times(Number(l.qtyRejected || 0), factor);
    if (!(rec > 0)) continue;
    if (rej < 0 || rej > rec) throw rule("VALIDATION", "Rejected cannot be more than delivered.");
    if (rej > 0 && !l.rejectionReason?.trim()) throw rule("REASON_REQUIRED", "Give a reason for the rejected quantity.");
    const accepted = minus(rec, rej);
    const outstanding = minus(minus(pl.qtyBase, pl.cancelledBase), poLineAccepted(pl.id));
    if (accepted > outstanding) throw rule("OVER_RECEIPT", `Line ${pl.lineNo}: accepted quantity is more than is outstanding (${qtyText(outstanding / factor)} ${pl.unitCode}).`);
    const unitCostBase = D(pl.unitPrice).dividedBy(factor).toDecimalPlaces(4).toNumber();
    g.lines.push({ poLineId: pl.id, itemId: pl.itemId, accepted, rejected: rej, reason: l.rejectionReason || null, unitCostBase });
  }
  if (!g.lines.length) throw rule("NO_LINES", "Enter the delivered quantity for at least one line.");
  db.receipts.push(g);
  for (const l of g.lines) {
    const pl = p.lines.find((x) => x.id === l.poLineId)!;
    if (l.accepted > 0) {
      post(a, { date: g.receivedDate, type: "receipt", itemId: l.itemId, locationId: g.locationId, status: "available", qty: l.accepted, sourceType: "goods_receipt", sourceId: g.id, sourceNumber: g.number, projectId: p.projectId, costCodeId: pl.costCodeId, note: null, unitCost: l.unitCostBase, value: times(l.accepted, l.unitCostBase, 2) });
      valueIn(l.itemId, l.accepted, l.unitCostBase);
      if (pl.mrLineId) db.reservations.push({ id: newId("res"), mrLineId: pl.mrLineId, locationId: g.locationId, itemId: l.itemId, qty: l.accepted, consumed: 0, status: "active", source: "receipt" });
    }
    if (l.rejected > 0) post(a, { date: g.receivedDate, type: "receipt_rejected", itemId: l.itemId, locationId: g.locationId, status: "rejected", qty: l.rejected, sourceType: "goods_receipt", sourceId: g.id, sourceNumber: g.number, projectId: p.projectId, costCodeId: pl.costCodeId, note: l.reason, unitCost: null, value: null });
  }
  const anyOpen = p.lines.some((pl) => minus(minus(pl.qtyBase, pl.cancelledBase), poLineAccepted(pl.id)) > 0);
  p.status = anyOpen ? "partially_received" : "received"; p.version++;
  audit(a, "receipt.post", "purchase_order", p.id, p.projectId, { number: g.number, deliveryNote: g.deliveryNoteRef });
  return g;
}

// ───────────── issues & transfers ─────────────
function issueStock(a: Actor, b: { idempotencyKey: string; locationId: string; issuedTo: string; issueDate?: string; lines: { mrLineId: string; qty: string | number }[] }) {
  need(a, "stock.issue");
  const dup = db.issues.find((i) => i.idem === b.idempotencyKey);
  if (dup) return dup;
  const location = needLocation(a, b.locationId);
  if (!b.issuedTo?.trim()) throw rule("VALIDATION", "Say who the material is issued to.");
  if (!b.lines?.length) throw rule("NO_LINES", "Enter a quantity for at least one line.");
  const iss: Issue = { id: newId("iss"), number: nextNumber("ISS"), idem: b.idempotencyKey };
  const date = b.issueDate ?? today();
  const plan = b.lines.map((l) => {
    const { mr, line } = mrLine(l.mrLineId);
    needProject(a, mr.projectId, "Material request");
    if (mr.status !== "approved") throw rule("MR_NOT_APPROVED", `${mr.number} is not approved.`);
    if (location.type === "site_store" && location.projectId !== mr.projectId) throw rule("WRONG_STORE", "That site store belongs to another project.");
    const qty = Number(l.qty);
    if (!(qty > 0)) throw rule("VALIDATION", "Quantity must be more than zero.");
    const f = fulfilment(line.id);
    if (qty > minus(f.requested, f.issued)) throw rule("OVER_ISSUE", `${item(line.itemId).code}: that is more than the request still needs.`);
    const own = db.reservations.filter((r) => r.mrLineId === line.id && r.locationId === location.id && r.status === "active");
    const ownQty = sum(own.map((r) => minus(r.qty, r.consumed)));
    const free = freeAt(line.itemId, location.id);
    if (qty > plus(ownQty, free)) throw rule("INSUFFICIENT_STOCK", `${item(line.itemId).code}: only ${qtyText(plus(ownQty, free))} usable at ${location.code} for this request.`);
    return { mr, line, qty, own };
  });
  for (const p of plan) {
    let left = p.qty;
    for (const r of p.own) { const take = Math.min(left, minus(r.qty, r.consumed)); if (take > 0) { consume(r, take); left = minus(left, take); } }
    const v = valueOut(p.line.itemId, p.qty);
    post(a, { date, type: "issue", itemId: p.line.itemId, locationId: location.id, status: "available", qty: -p.qty, sourceType: "stock_issue", sourceId: iss.id, sourceNumber: iss.number, projectId: p.mr.projectId, costCodeId: p.line.costCodeId, note: b.issuedTo, unitCost: v.unitCost, value: -v.value });
    (db.movements.at(-1) as Movement & { mrLineId?: string }).mrLineId = p.line.id;
    audit(a, "issue.post", "material_request", p.mr.id, p.mr.projectId, { number: iss.number, item: item(p.line.itemId).code, qty: p.qty, to: b.issuedTo });
  }
  db.issues.push(iss);
  return iss;
}
function dispatch(a: Actor, b: { idempotencyKey: string; fromLocationId: string; toLocationId: string; dispatchDate?: string; vehicleRef?: string | null; notes?: string | null; lines: { itemId: string; qty: string | number; mrLineId?: string | null }[] }) {
  need(a, "stock.transfer");
  const dup = db.transfers.find((t) => t.idem === b.idempotencyKey);
  if (dup) return dup;
  needLocation(a, b.fromLocationId); needLocation(a, b.toLocationId);
  if (!b.toLocationId) throw rule("VALIDATION", "Choose where to send it.");
  if (b.fromLocationId === b.toLocationId) throw rule("VALIDATION", "From and to must be different.");
  if (!b.lines?.length) throw rule("NO_LINES", "Enter a quantity for at least one item.");
  const t: Transfer = { id: newId("trf"), number: nextNumber("TRF"), fromId: b.fromLocationId, toId: b.toLocationId, status: "in_transit", dispatchDate: b.dispatchDate ?? today(), receivedDate: null,
    vehicleRef: b.vehicleRef || null, notes: b.notes || null, dispatchedBy: a.user.id, idem: b.idempotencyKey, lines: [] };
  for (const l of b.lines) {
    const qty = Number(l.qty);
    if (!(qty > 0)) throw rule("VALIDATION", "Quantity must be more than zero.");
    if (l.mrLineId) {
      const r = db.reservations.find((x) => x.mrLineId === l.mrLineId && x.locationId === b.fromLocationId && x.status === "active" && minus(x.qty, x.consumed) >= qty);
      if (!r) throw rule("NOT_RESERVED", "That quantity is not reserved here for the request.");
      consume(r, qty);
    } else if (qty > freeAt(l.itemId, b.fromLocationId)) throw rule("INSUFFICIENT_STOCK", `Only ${qtyText(freeAt(l.itemId, b.fromLocationId))} ${item(l.itemId).baseUnit} of ${item(l.itemId).code} is free at ${loc(b.fromLocationId).code}.`);
    t.lines.push({ id: newId("trl"), itemId: l.itemId, qty, mrLineId: l.mrLineId || null, received: null, short: null, discStatus: "none", note: null });
  }
  db.transfers.push(t);
  for (const l of t.lines) {
    post(a, { date: t.dispatchDate, type: "transfer_out", itemId: l.itemId, locationId: t.fromId, status: "available", qty: -l.qty, sourceType: "stock_transfer", sourceId: t.id, sourceNumber: t.number, projectId: null, costCodeId: null, note: null, unitCost: null, value: null });
    post(a, { date: t.dispatchDate, type: "transfer_dispatch", itemId: l.itemId, locationId: transit().id, status: "in_transit", qty: l.qty, sourceType: "stock_transfer", sourceId: t.id, sourceNumber: t.number, projectId: null, costCodeId: null, note: `to ${loc(t.toId).code}`, unitCost: null, value: null });
  }
  audit(a, "transfer.dispatch", "stock_transfer", t.id, null, { number: t.number });
  return t;
}
function receiveTransfer(a: Actor, id: string, b: { receivedDate?: string; lines: { lineId: string; qtyReceived: string; note?: string | null }[] }) {
  need(a, "stock.transfer");
  const t = byId(db.transfers, id, "Transfer");
  needLocation(a, t.toId);
  if (t.status !== "in_transit") throw rule("INVALID_STATE", "This transfer has already been received.");
  const date = b.receivedDate ?? today();
  for (const l of t.lines) {
    const inp = b.lines.find((x) => x.lineId === l.id);
    const rec = inp ? Number(inp.qtyReceived) : l.qty;
    if (!(rec >= 0) || rec > l.qty) throw rule("VALIDATION", "Received cannot be more than dispatched.");
    const short = minus(l.qty, rec);
    if (short > 0 && !inp?.note?.trim()) throw rule("NOTE_REQUIRED", `${item(l.itemId).code}: add a note explaining the shortage.`);
    Object.assign(l, { received: rec, short, discStatus: short > 0 ? "open" : "none", note: inp?.note || null });
  }
  for (const l of t.lines) {
    post(a, { date, type: "transfer_arrive", itemId: l.itemId, locationId: transit().id, status: "in_transit", qty: -l.qty, sourceType: "stock_transfer", sourceId: t.id, sourceNumber: t.number, projectId: null, costCodeId: null, note: null, unitCost: null, value: null });
    if (l.received! > 0) post(a, { date, type: "transfer_in", itemId: l.itemId, locationId: t.toId, status: "available", qty: l.received!, sourceType: "stock_transfer", sourceId: t.id, sourceNumber: t.number, projectId: null, costCodeId: null, note: null, unitCost: null, value: null });
    if (l.short! > 0) post(a, { date, type: "transfer_discrepancy", itemId: l.itemId, locationId: transit().id, status: "discrepancy", qty: l.short!, sourceType: "stock_transfer", sourceId: t.id, sourceNumber: t.number, projectId: null, costCodeId: null, note: l.note, unitCost: null, value: null });
    if (l.mrLineId && l.received! > 0) db.reservations.push({ id: newId("res"), mrLineId: l.mrLineId, locationId: t.toId, itemId: l.itemId, qty: l.received!, consumed: 0, status: "active", source: "transfer" });
  }
  t.status = t.lines.some((l) => l.discStatus === "open") ? "received_with_discrepancy" : "received";
  t.receivedDate = date;
  audit(a, "transfer.receive", "stock_transfer", t.id, null, { number: t.number });
}
function resolveLine(a: Actor, lineId: string, resolution: "found" | "written_off", note: string) {
  need(a, "stock.adjust");
  const t = db.transfers.find((x) => x.lines.some((l) => l.id === lineId));
  if (!t) throw notFound("Transfer line");
  const l = t.lines.find((x) => x.id === lineId)!;
  if (l.discStatus !== "open") throw rule("INVALID_STATE", "This line has no open discrepancy.");
  if (!note?.trim()) throw rule("NOTE_REQUIRED", "A note is required.");
  const date = today();
  post(a, { date, type: resolution === "found" ? "discrepancy_found" : "write_off", itemId: l.itemId, locationId: transit().id, status: "discrepancy", qty: -l.short!, sourceType: "stock_transfer", sourceId: t.id, sourceNumber: t.number, projectId: null, costCodeId: null, note, unitCost: null, value: null });
  if (resolution === "found") post(a, { date, type: "transfer_in", itemId: l.itemId, locationId: t.toId, status: "available", qty: l.short!, sourceType: "stock_transfer", sourceId: t.id, sourceNumber: t.number, projectId: null, costCodeId: null, note, unitCost: null, value: null });
  else { const v = valueOut(l.itemId, l.short!); db.movements.at(-1)!.value = -v.value; db.movements.at(-1)!.unitCost = v.unitCost; }
  l.discStatus = resolution; l.note = note;
  if (!t.lines.some((x) => x.discStatus === "open")) t.status = "received";
  audit(a, `transfer.${resolution}`, "stock_transfer", t.id, null, { number: t.number, note });
}
function opening(a: Actor, itemId: string, locationId: string, qty: Num, unitCost: Num, date: string) {
  post(a, { date, type: "opening", itemId, locationId, status: "available", qty, sourceType: "opening_balance", sourceId: "opening", sourceNumber: "OPENING-DEMO", projectId: null, costCodeId: null, note: null, unitCost, value: times(qty, unitCost, 2) });
  valueIn(itemId, qty, unitCost);
}

// ───────────── read models ─────────────
function stockRows(a: Actor, f: { locationId?: string | null; itemId?: string | null; projectId?: string | null }) {
  need(a, "stock.view");
  const showCost = can(a, "cost.view");
  const locs = visibleLocations(a).filter((l) => (!f.locationId || l.id === f.locationId) && (!f.projectId || l.projectId === f.projectId));
  const rows = [];
  for (const l of locs) for (const it of db.items) {
    if (f.itemId && it.id !== f.itemId) continue;
    const s = (st: string) => bal(it.id, l.id, st);
    const available = s("available"), reserved = reservedAt(it.id, l.id);
    const vals = [available, s("quarantine"), s("rejected"), s("in_transit"), s("discrepancy")];
    if (vals.every((v) => v === 0) && reserved === 0) continue;
    const avg = valuation(it.id).avg;
    rows.push({ itemId: it.id, itemCode: it.code, description: it.description, baseUnit: it.baseUnit, locationId: l.id, locationCode: l.code, locationType: l.type,
      available: q4(available), reserved: q4(reserved), free: q4(minus(available, reserved)), quarantine: q4(s("quarantine")), rejected: q4(s("rejected")),
      inTransit: q4(s("in_transit")), discrepancy: q4(s("discrepancy")), reorderLevel: it.reorderLevel,
      belowReorder: l.type === "warehouse" && it.reorderLevel !== null && available < it.reorderLevel,
      avgUnitCost: showCost ? q4(avg) : null, availableValue: showCost ? m2(times(available, avg, 2)) : null });
  }
  return rows.sort((x, y) => x.locationCode.localeCompare(y.locationCode) || x.itemCode.localeCompare(y.itemCode));
}
function mrOut(a: Actor, m: Mr) {
  const p = project(m.projectId);
  return {
    id: m.id, number: m.number, status: m.status, revision: m.revision, version: m.version, projectId: m.projectId, projectCode: p.code, projectName: p.name, siteId: m.siteId,
    siteName: db.sites.find((s) => s.id === m.siteId)?.name ?? null, requiredDate: m.requiredDate, purpose: m.purpose, requesterName: userName(m.requestedBy), requestedBy: m.requestedBy, createdAt: m.createdAt,
    lines: m.lines.map((l) => {
      const it = item(l.itemId), c = cc(l.costCodeId);
      return { ...l, qty: q4(l.qty), itemCode: it.code, itemDescription: it.description, baseUnit: it.baseUnit, costCode: c.code, costCodeName: c.name, fulfilment: fulfilmentOut(fulfilment(l.id)),
        reservations: db.reservations.filter((r) => r.mrLineId === l.id).map((r) => ({ id: r.id, location_code: loc(r.locationId).code, qty: q4(r.qty), qty_consumed: q4(r.consumed), status: r.status, source: r.source })) };
    }),
    approvals: approvalsOut("material_request", m.id),
  };
}
function poOut(a: Actor, p: Po) {
  const prices = can(a, "rates.view");
  const sup = db.suppliers.find((s) => s.id === p.supplierId)!;
  const dl = loc(p.deliveryLocationId), pr = project(p.projectId);
  const net = subtotal(p), vat = sum(p.lines.map((l) => l.lineVat));
  return {
    id: p.id, number: p.number, status: p.status, revision: p.revision, version: p.version, projectId: p.projectId, projectCode: pr.code, projectName: pr.name, supplierId: p.supplierId,
    supplierName: sup.name, supplierTrn: sup.trn, deliveryLocationId: dl.id, deliveryLocationCode: dl.code, deliveryLocationName: dl.name, requiredDate: p.requiredDate, promisedDate: p.promisedDate,
    paymentTerms: p.paymentTerms, supplierQuoteRef: p.supplierQuoteRef, notes: p.notes, subtotal: prices ? m2(net) : null, vatAmount: prices ? m2(vat) : null, total: prices ? m2(plus(net, vat)) : null,
    createdBy: p.createdBy, creatorName: userName(p.createdBy), pricesVisible: prices,
    lines: p.lines.map((l) => {
      const it = item(l.itemId);
      const mr = l.mrLineId ? mrLine(l.mrLineId).mr : null;
      return { id: l.id, lineNo: l.lineNo, itemId: l.itemId, mrLineId: l.mrLineId, costCodeId: l.costCodeId, unitCode: l.unitCode, qty: q4(l.qty), qtyBase: q4(l.qtyBase),
        unitPrice: prices ? q4(l.unitPrice) : null, vatCode: l.vatCode, lineNet: prices ? m2(l.lineNet) : null, lineVat: prices ? m2(l.lineVat) : null, qtyCancelledBase: q4(l.cancelledBase),
        itemCode: it.code, itemDescription: it.description, baseUnit: it.baseUnit, costCode: cc(l.costCodeId).code, acceptedBase: q4(poLineAccepted(l.id)), rejectedBase: q4(poLineRejected(l.id)),
        outstandingBase: q4(Math.max(0, minus(minus(l.qtyBase, l.cancelledBase), poLineAccepted(l.id)))), mrNumber: mr?.number ?? null, mrId: mr?.id ?? null };
    }),
    receipts: db.receipts.filter((g) => g.poId === p.id).map((g) => ({ id: g.id, number: g.number, receivedDate: g.receivedDate, deliveryNoteRef: g.deliveryNoteRef, receivedByName: userName(g.receivedBy), locationCode: loc(g.locationId).code })),
    approvals: approvalsOut("purchase_order", p.id),
  };
}
const COMMITTED = ["approved", "partially_received", "received", "closed"];
function drillRows(projectId: string, metric: string, costCodeId?: string | null) {
  const okCc = (id: string | null) => !costCodeId || id === costCodeId;
  if (metric === "committed") {
    return db.pos.filter((p) => p.projectId === projectId && COMMITTED.includes(p.status)).flatMap((p) => p.lines.filter((l) => okCc(l.costCodeId)).map((l) => {
      const it = item(l.itemId), q = minus(l.qtyBase, l.cancelledBase);
      return { docId: p.id, docNumber: p.number, docType: "purchase_order", lineNo: String(l.lineNo), itemCode: it.code, costCodeId: l.costCodeId, costCode: cc(l.costCodeId).code,
        qtyBase: q4(q), baseUnit: it.baseUnit, value: m2(D(l.lineNet).times(q).dividedBy(l.qtyBase)), date: (p.approvedAt ?? "").slice(0, 10) };
    }));
  }
  if (metric === "received") {
    return db.receipts.filter((g) => g.projectId === projectId).flatMap((g) => g.lines.filter((l) => l.accepted > 0).map((l) => {
      const pl = db.pos.find((p) => p.id === g.poId)!.lines.find((x) => x.id === l.poLineId)!, it = item(l.itemId);
      return okCc(pl.costCodeId) ? [{ docId: g.poId, docNumber: g.number, docType: "goods_receipt", lineNo: String(pl.lineNo), itemCode: it.code, costCodeId: pl.costCodeId, costCode: cc(pl.costCodeId).code,
        qtyBase: q4(l.accepted), baseUnit: it.baseUnit, value: m2(times(l.accepted, l.unitCostBase, 2)), date: g.receivedDate }] : [];
    }).flat());
  }
  return db.movements.filter((m) => m.projectId === projectId && m.type === "issue" && okCc(m.costCodeId)).map((m) => {
    const it = item(m.itemId);
    return { docId: m.sourceId, docNumber: m.sourceNumber, docType: m.sourceType, lineNo: String(m.seq), itemCode: it.code, costCodeId: m.costCodeId!, costCode: cc(m.costCodeId!).code,
      qtyBase: q4(-m.qty), baseUnit: it.baseUnit, value: m2(-(m.value ?? 0)), date: m.date };
  });
}
function report(a: Actor, projectId: string) {
  need(a, "report.view");
  needProject(a, projectId, "Project");
  const pr = byId(db.projects, projectId, "Project");
  const show = can(a, "cost.view");
  const money = (v: string) => (show ? v : null);
  const rows = { committed: drillRows(projectId, "committed"), received: drillRows(projectId, "received"), issued: drillRows(projectId, "issued") };
  const tot = (r: { value: string }[]) => sum(r.map((x) => x.value));
  const committed = tot(rows.committed), received = tot(rows.received), issued = tot(rows.issued);
  const pending = db.pos.filter((p) => p.projectId === projectId && p.status === "pending_approval");
  const siteStock = stockRows(a, { projectId }).filter((r) => r.locationType === "site_store");
  const byCc = new Map<string, { costCodeId: string; costCode: string; committed: Num; received: Num; issued: Num }>();
  for (const k of ["committed", "received", "issued"] as const) for (const r of rows[k]) {
    const e = byCc.get(r.costCodeId) ?? { costCodeId: r.costCodeId, costCode: r.costCode, committed: 0, received: 0, issued: 0 };
    e[k] = plus(e[k], r.value); byCc.set(r.costCodeId, e);
  }
  const t = today();
  const statuses = new Map<string, number>();
  for (const m of db.mrs.filter((x) => x.projectId === projectId)) statuses.set(m.status, (statuses.get(m.status) ?? 0) + 1);
  const openLines = db.mrs.filter((m) => m.projectId === projectId && m.status === "approved").sort((x, y) => x.requiredDate.localeCompare(y.requiredDate) || x.number.localeCompare(y.number))
    .flatMap((m) => m.lines.map((l) => ({ m, l, f: fulfilment(l.id) }))).filter((x) => x.f.requested > x.f.issued)
    .map(({ m, l, f }) => ({ id: l.id, mr_id: m.id, number: m.number, line_no: l.lineNo, item_code: item(l.itemId).code, base_unit: item(l.itemId).baseUnit, required_date: m.requiredDate,
      requested: q4(f.requested), issued: q4(f.issued), reserved: q4(f.reserved), onOrder: q4(f.onOrder), inTransit: q4(f.inTransit), uncovered: q4(f.uncovered), overdue: m.requiredDate < t }));
  const openPos = db.pos.filter((p) => p.projectId === projectId && ["approved", "partially_received"].includes(p.status)).map((p) => {
    const outstanding = p.lines.filter((l) => minus(minus(l.qtyBase, l.cancelledBase), poLineAccepted(l.id)) > 0).length;
    return { id: p.id, number: p.number, status: p.status, supplier: db.suppliers.find((s) => s.id === p.supplierId)!.name, promised_date: p.promisedDate, outstanding_lines: outstanding,
      overdue: !!p.promisedDate && p.promisedDate < t && outstanding > 0, sortKey: p.promisedDate ?? p.requiredDate ?? "9999" };
  }).sort((x, y) => x.sortKey.localeCompare(y.sortKey));
  return {
    project: { id: pr.id, code: pr.code, name: pr.name, status: pr.status, contractValue: money(m2(pr.contractValue)) },
    generatedAt: nowIso(), asOfLabel: `As at ${t} (Dubai), live data`, currency: "AED", vatBasis: "Values exclude VAT", costVisible: show,
    summary: {
      committed: money(m2(committed)), receivedValue: money(m2(received)), openCommitment: money(m2(minus(committed, received))), issuedCost: money(m2(issued)),
      siteStockValue: show ? m2(sum(siteStock.map((s) => s.availableValue ?? 0))) : null,
      pendingApprovalValue: money(m2(sum(pending.map(subtotal)))), pendingApprovalCount: pending.length,
      invoiced: null, paid: null, labourCost: null, subcontractCost: null, approvedBudget: null, forecastFinalCost: null, notTrackedReason: "Not tracked in Phase 1",
    },
    byCostCode: [...byCc.values()].map((e) => ({ ...e, costCodeName: cc(e.costCodeId).name, committed: money(m2(e.committed)), received: money(m2(e.received)), issued: money(m2(e.issued)) }))
      .sort((x, y) => x.costCode.localeCompare(y.costCode)),
    materialRequests: { byStatus: [...statuses].map(([status, n]) => ({ status, n })), openLines },
    openPurchaseOrders: openPos,
  };
}
function dashboard(a: Actor) {
  const t = today();
  type A = { kind: string; title: string; detail: string; due: string | null; overdue: boolean; owner: string | null; link: string; projectCode: string | null };
  const actions: A[] = [];
  for (const p of myPending(a)) actions.push({ kind: "approval", title: `Approve ${p.docNumber}`, detail: `${p.docType === "purchase_order" ? "Purchase order" : "Material request"} from ${p.requesterName} (step ${p.stepNo}: ${p.roleKey})`,
    due: null, overdue: false, owner: "You", projectCode: p.projectCode, link: p.docType === "purchase_order" ? `/purchase-orders/${p.docId}` : `/material-requests/${p.docId}` });
  for (const m of db.mrs.filter((x) => x.requestedBy === a.user.id && ["draft", "rejected"].includes(x.status)))
    actions.push({ kind: "my_draft", title: `${m.status === "rejected" ? "Rejected" : "Draft"}: ${m.number}`, detail: m.status === "rejected" ? "Revise and resubmit, or cancel" : "Not yet submitted", due: null, overdue: false, owner: "You", projectCode: project(m.projectId).code, link: `/material-requests/${m.id}` });
  for (const p of db.pos.filter((x) => x.createdBy === a.user.id && ["draft", "rejected"].includes(x.status)))
    actions.push({ kind: "my_draft", title: `${p.status === "rejected" ? "Rejected" : "Draft"}: ${p.number}`, detail: p.status === "rejected" ? "Revise and resubmit, or cancel" : "Not yet submitted", due: null, overdue: false, owner: "You", projectCode: project(p.projectId).code, link: `/purchase-orders/${p.id}` });
  if (can(a, "mr.allocate") || can(a, "po.create")) for (const m of db.mrs.filter((x) => x.status === "approved" && inScope(a, x.projectId))) for (const l of m.lines) {
    const f = fulfilment(l.id);
    if (f.uncovered > 0) actions.push({ kind: "mr_uncovered", title: `${m.number} line ${l.lineNo}: ${qtyText(f.uncovered)} ${item(l.itemId).code} not covered`, detail: "Reserve stock or raise a purchase order",
      due: m.requiredDate, overdue: m.requiredDate < t, owner: "Procurement / Stores", projectCode: project(m.projectId).code, link: `/material-requests/${m.id}` });
  }
  if (can(a, "po.view")) for (const p of db.pos.filter((x) => ["approved", "partially_received"].includes(x.status) && inScope(a, x.projectId))) {
    const due = p.promisedDate ?? p.requiredDate;
    actions.push({ kind: "po_delivery", title: `${p.number} awaiting delivery`, detail: `${db.suppliers.find((s) => s.id === p.supplierId)!.name}${p.promisedDate ? "" : " — no promised date recorded"}`,
      due, overdue: !!due && due < t, owner: userName(p.createdBy), projectCode: project(p.projectId).code, link: `/purchase-orders/${p.id}` });
  }
  if (can(a, "stock.transfer") || can(a, "stock.adjust")) {
    const vis = new Set(visibleLocations(a).map((l) => l.id));
    for (const tr of db.transfers.filter((x) => vis.has(x.toId))) {
      if (tr.status === "in_transit" && can(a, "stock.transfer")) actions.push({ kind: "transfer_in_transit", title: `${tr.number} in transit to ${loc(tr.toId).code}`, detail: "Confirm receipt when it arrives", due: tr.dispatchDate, overdue: tr.dispatchDate < t, owner: "Receiving storekeeper", projectCode: null, link: `/transfers/${tr.id}` });
      const open = tr.lines.filter((l) => l.discStatus === "open").length;
      if (open && can(a, "stock.adjust")) actions.push({ kind: "discrepancy", title: `${tr.number}: ${open} open discrepancy line(s)`, detail: "Investigate and resolve (found / write-off)", due: null, overdue: true, owner: "Stores manager", projectCode: null, link: `/transfers/${tr.id}` });
    }
  }
  if (can(a, "stock.view") && can(a, "mr.allocate")) for (const s of stockRows(a, {}).filter((x) => x.belowReorder))
    actions.push({ kind: "low_stock", title: `Low stock: ${s.itemCode} at ${s.locationCode}`, detail: `${qtyText(Number(s.available))} ${s.baseUnit} available, reorder level ${qtyText(s.reorderLevel ?? 0)}`, due: null, overdue: false, owner: "Stores", projectCode: null, link: `/stock?item=${s.itemId}` });
  if (can(a, "submittal.manage")) for (const s of db.submittals.filter((x) => ["with_consultant", "revise_resubmit", "rejected"].includes(x.status) && inScope(a, x.projectId))) {
    const st = subState(s, t);
    if (st.overdue) actions.push({ kind: "submittal_overdue", title: `${s.number} overdue with the consultant (${st.daysOverdue} days)`, detail: `${s.title} · chase the consultant`, due: st.dueDate, overdue: true, owner: "Document controller", projectCode: project(s.projectId).code, link: `/submittals/${s.id}` });
    else if (st.ballInCourt === "edge") actions.push({ kind: "submittal_resubmit", title: `Resubmit ${s.number}`, detail: `${s.title} · returned ${s.status === "rejected" ? "rejected" : "for revision"}`, due: s.requiredBy, overdue: st.lateForSite, owner: "Document controller", projectCode: project(s.projectId).code, link: `/submittals/${s.id}` });
  }
  const reportDay = lastWorkday(t);
  if (can(a, "sitereport.create") && !a.all) for (const p of db.projects.filter((x) => a.user.projects.includes(x.id) && x.status === "active")) {
    if (!db.siteReports.some((r) => r.projectId === p.id && r.reportDate === reportDay && ["submitted", "reviewed"].includes(r.status)))
      actions.push({ kind: "site_report_missing", title: `Daily report missing for ${reportDay}`, detail: "Write and submit the site report", due: reportDay, overdue: true, owner: "Site team", projectCode: p.code, link: `/site-reports/new?project=${p.id}&date=${reportDay}` });
  }
  if (can(a, "sitereport.review")) for (const r of db.siteReports.filter((x) => x.status === "submitted" && inScope(a, x.projectId) && x.createdBy !== a.user.id))
    actions.push({ kind: "site_report_review", title: `Review the daily report of ${r.reportDate}`, detail: "Accept it or return it with a comment", due: null, overdue: false, owner: "You", projectCode: project(r.projectId).code, link: `/site-reports/${r.id}` });
  actions.sort((x, y) => Number(y.overdue) - Number(x.overdue) || (x.due ?? "9999").localeCompare(y.due ?? "9999"));
  return { today: t, actions, projects: db.projects.filter((p) => inScope(a, p.id)).map(({ id, code, name, status }) => ({ id, code, name, status })) };
}
const me = (a: Actor) => ({ userId: a.user.id, email: a.user.email, fullName: a.user.fullName, roles: a.user.roles, permissions: [...a.perms].sort(), allProjects: a.all });

// ───────────── project control: submittals, site reports, progress, overview ─────────────
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const WORKDAYS = [1, 2, 3, 4, 5, 6];
function lastWorkday(t: string) { let d = addDays(t, -1); while (!WORKDAYS.includes(weekday(d))) d = addDays(d, -1); return d; }
function workdaysBetween(from: string, to: string) { let n = 0; for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (WORKDAYS.includes(weekday(d))) n++; return n; }
const DONE_SUB = ["approved", "closed", "cancelled"];
const STATUS_AFTER: Record<string, string> = { approved: "approved", approved_as_noted: "approved", revise_resubmit: "revise_resubmit", rejected: "rejected", for_information: "closed" };
const curRev = (s: Submittal) => db.revisions.find((r) => r.submittalId === s.id && r.revNo === s.currentRevision);
function subState(s: Submittal, t = today()) {
  const cur = curRev(s);
  const withC = s.status === "with_consultant";
  const daysOverdue = withC && cur ? Math.max(0, daysBetween(cur.dueDate, t)) : 0;
  return { ballInCourt: withC ? "consultant" : DONE_SUB.includes(s.status) ? null : "edge", daysWithConsultant: withC && cur ? daysBetween(cur.submittedDate, t) : null,
    dueDate: withC ? cur?.dueDate ?? null : null, daysOverdue, overdue: daysOverdue > 0, lateForSite: !!s.requiredBy && s.requiredBy < t && !DONE_SUB.includes(s.status) };
}
function blockingSubmittals(projectId: string, itemIds: string[]) {
  const out: { itemCode: string; numbers: string[] }[] = [];
  for (const itemId of itemIds) {
    const mine = db.submittals.filter((s) => s.projectId === projectId && s.status !== "cancelled" && s.itemIds.includes(itemId));
    if (!mine.length || mine.some((s) => s.status === "approved" || s.status === "closed")) continue;
    out.push({ itemCode: item(itemId).code, numbers: mine.map((s) => `${s.number} (${s.status.replace(/_/g, " ")})`) });
  }
  return out;
}
const getSub = (a: Actor, id: string) => { need(a, "submittal.view"); const s = byId(db.submittals, id, "Submittal"); needProject(a, s.projectId, "Submittal"); return s; };
function subRow(s: Submittal) {
  const pr = project(s.projectId);
  const last = db.revisions.filter((r) => r.submittalId === s.id && r.outcome).sort((x, y) => y.revNo - x.revNo)[0];
  return { ...s, projectCode: pr.code, projectName: pr.name, consultantName: db.partners.find((c) => c.id === s.consultantId)?.name ?? null,
    subcontractorName: db.partners.find((c) => c.id === s.subcontractorId)?.name ?? null, lastOutcome: last?.outcome ?? null, ...subState(s) };
}
type SubIn = { projectId: string; type: string; title: string; discipline: string; specSection?: string | null; area?: string | null; subcontractorId?: string | null; consultantId?: string | null; requiredBy?: string | null; itemIds?: string[] };
function createSub(a: Actor, b: SubIn) {
  need(a, "submittal.manage"); needProject(a, b.projectId, "Project");
  if (!b.title?.trim()) throw rule("TITLE_REQUIRED", "Give the submittal a title.");
  const s: Submittal = { id: newId("sub"), number: nextNumber("SUB"), projectId: b.projectId, type: b.type, title: b.title.trim(), discipline: b.discipline, specSection: b.specSection || null,
    area: b.area || null, subcontractorId: b.subcontractorId || null, consultantId: b.consultantId || project(b.projectId).consultantId, requiredBy: b.requiredBy || null, status: "draft",
    currentRevision: 0, version: 1, createdBy: a.user.id, createdAt: nowIso(), itemIds: [...new Set(b.itemIds ?? [])] };
  db.submittals.push(s);
  audit(a, "submittal.created", "submittal", s.id, s.projectId, { number: s.number, title: s.title });
  return s;
}
function sendSub(a: Actor, id: string, b: { submittedDate: string; transmittalRef?: string | null; notes?: string | null }) {
  need(a, "submittal.manage");
  const s = getSub(a, id);
  if (!["draft", "revise_resubmit", "rejected"].includes(s.status)) throw rule("INVALID_STATE", "Only a draft, or a submittal returned for resubmission, can be sent to the consultant.");
  if (b.submittedDate > today()) throw rule("FUTURE_DATE", "The submission date cannot be in the future.");
  const last = curRev(s);
  if (last?.returnedDate && b.submittedDate < last.returnedDate) throw rule("DATE_ORDER", "A resubmission cannot be dated before the consultant returned the previous revision.");
  const revNo = s.status === "draft" ? s.currentRevision : s.currentRevision + 1;
  const dueDate = addDays(b.submittedDate, project(s.projectId).reviewDays);
  db.revisions.push({ id: newId("rev"), submittalId: s.id, revNo, submittedDate: b.submittedDate, dueDate, transmittalRef: b.transmittalRef || null, notes: b.notes || null, submittedBy: a.user.id,
    returnedDate: null, codeId: null, outcome: null, consultantComments: null, reviewerName: null, inspectionDate: null, recordedBy: null });
  Object.assign(s, { status: "with_consultant", currentRevision: revNo, version: s.version + 1 });
  audit(a, "submittal.submitted", "submittal", s.id, s.projectId, { number: s.number, revision: revNo, dueDate });
}
function respondSub(a: Actor, id: string, b: { codeId: string; returnedDate: string; consultantComments?: string | null; reviewerName?: string | null; inspectionDate?: string | null }) {
  need(a, "submittal.manage");
  const s = getSub(a, id);
  if (s.status !== "with_consultant") throw rule("INVALID_STATE", "This submittal is not waiting for a consultant response.");
  const code = db.codes.find((c) => c.id === b.codeId && c.projectId === s.projectId);
  if (!code) throw rule("UNKNOWN_CODE", "Choose one of this project's consultant codes.");
  const rev = curRev(s)!;
  if (b.returnedDate < rev.submittedDate) throw rule("DATE_ORDER", "The response cannot be dated before the submission.");
  if (b.returnedDate > today()) throw rule("FUTURE_DATE", "The response date cannot be in the future.");
  if ((code.outcome === "revise_resubmit" || code.outcome === "rejected") && !b.consultantComments?.trim()) throw rule("COMMENTS_REQUIRED", "Record the consultant's comments so the team knows what to change.");
  Object.assign(rev, { returnedDate: b.returnedDate, codeId: code.id, outcome: code.outcome, consultantComments: b.consultantComments || null, reviewerName: b.reviewerName || null, inspectionDate: b.inspectionDate || null, recordedBy: a.user.id });
  Object.assign(s, { status: STATUS_AFTER[code.outcome], version: s.version + 1 });
  audit(a, "submittal.response", "submittal", s.id, s.projectId, { number: s.number, revision: rev.revNo, code: code.code });
}
function setCodes(a: Actor, projectId: string, codes: { code: string; label: string; outcome: string }[]) {
  need(a, "submittal.manage"); needProject(a, projectId, "Project");
  if (!codes.length) throw rule("NO_CODES", "Add at least one code.");
  const keys = codes.map((c) => c.code.trim());
  if (keys.some((k) => !k) || new Set(keys).size !== keys.length) throw rule("DUPLICATE_CODE", "Each code must be filled in and appear only once.");
  if (!codes.some((c) => c.outcome === "approved" || c.outcome === "approved_as_noted")) throw rule("NO_APPROVAL_CODE", "At least one code must mean approved.");
  const existing = db.codes.filter((c) => c.projectId === projectId);
  for (const old of existing) {
    const next = codes.find((c) => c.code.trim() === old.code);
    if (db.revisions.some((r) => r.codeId === old.id) && (!next || next.outcome !== old.outcome)) throw rule("CODE_IN_USE", `Code ${old.code} is already used on a consultant response, so it cannot be removed or given a different meaning.`);
  }
  for (const [i, c] of codes.entries()) {
    const old = existing.find((x) => x.code === c.code.trim());
    if (old) Object.assign(old, { label: c.label.trim(), outcome: c.outcome, sortOrder: i });
    else db.codes.push({ id: newId("code"), projectId, code: c.code.trim(), label: c.label.trim(), outcome: c.outcome, sortOrder: i });
  }
  db.codes = db.codes.filter((c) => c.projectId !== projectId || keys.includes(c.code));
  return db.codes.filter((c) => c.projectId === projectId).sort((x, y) => x.sortOrder - y.sortOrder);
}

type ReportIn = { projectId: string; siteId?: string | null; reportDate: string; weather?: string | null; workDone: string; issues?: string | null; delayCause?: string | null; inspections?: string | null; visitors?: string | null; safetyIncidents?: number; safetyNotes?: string | null; manpower: { trade: string; companyId?: string | null; headcount: number }[] };
function checkReport(b: Omit<ReportIn, "reportDate" | "projectId">) {
  for (const m of b.manpower) if (!m.trade?.trim() || !(m.headcount > 0)) throw rule("INVALID_HEADCOUNT", "Each manpower line needs a trade and a headcount above zero.");
  if ((b.safetyIncidents ?? 0) > 0 && !b.safetyNotes?.trim()) throw rule("SAFETY_NOTES_REQUIRED", "Describe the safety incident.");
  if (b.delayCause && !b.issues?.trim()) throw rule("ISSUES_REQUIRED", "Describe what held the work up.");
}
const reportFields = (b: Omit<ReportIn, "reportDate" | "projectId">) => ({ weather: b.weather || null, workDone: (b.workDone ?? "").trim(), issues: b.issues || null, delayCause: b.delayCause || null,
  inspections: b.inspections || null, visitors: b.visitors || null, safetyIncidents: b.safetyIncidents ?? 0, safetyNotes: b.safetyNotes || null,
  manpower: b.manpower.map((m) => ({ id: newId("mp"), trade: m.trade.trim(), companyId: m.companyId || null, headcount: m.headcount })) });
function createReport(a: Actor, b: ReportIn) {
  need(a, "sitereport.create"); needProject(a, b.projectId, "Project");
  const t = today();
  if (b.reportDate > t) throw rule("FUTURE_DATE", "A daily report cannot be for a future date.");
  if (b.reportDate < addDays(t, -7)) throw rule("TOO_LATE", "Daily reports can be written up to 7 days late.");
  if (db.siteReports.some((r) => r.projectId === b.projectId && (r.siteId ?? "") === (b.siteId ?? "") && r.reportDate === b.reportDate)) throw rule("REPORT_EXISTS", "There is already a report for this site and day. Open it instead.");
  checkReport(b);
  const r: SiteReport = { id: newId("rep"), projectId: b.projectId, siteId: b.siteId || null, reportDate: b.reportDate, status: "draft", createdBy: a.user.id, submittedAt: null, reviewedBy: null, reviewedAt: null, reviewComment: null, version: 1, ...reportFields(b) };
  db.siteReports.push(r);
  audit(a, "sitereport.created", "site_report", r.id, r.projectId, { date: r.reportDate });
  return r;
}
const getReport = (a: Actor, id: string) => { need(a, "project.view"); const r = byId(db.siteReports, id, "Site report"); needProject(a, r.projectId, "Site report"); return r; };
function submitReport(a: Actor, id: string) {
  need(a, "sitereport.create");
  const r = getReport(a, id);
  if (!["draft", "returned"].includes(r.status)) throw rule("INVALID_STATE", "This report has already been submitted.");
  if (!r.workDone.trim()) throw rule("WORK_REQUIRED", "Say what work was done (or why none was done).");
  Object.assign(r, { status: "submitted", submittedAt: nowIso(), version: r.version + 1 });
  audit(a, "sitereport.submitted", "site_report", r.id, r.projectId, { date: r.reportDate });
}
function reviewReport(a: Actor, id: string, decision: string, comment?: string | null) {
  need(a, "sitereport.review");
  const r = getReport(a, id);
  if (r.status !== "submitted") throw rule("INVALID_STATE", "Only a submitted report can be reviewed.");
  if (r.createdBy === a.user.id) throw rule("OWN_REPORT", "You cannot review a report you wrote.");
  if (decision === "return" && !comment?.trim()) throw rule("COMMENT_REQUIRED", "Say what needs to be corrected.");
  Object.assign(r, { status: decision === "accept" ? "reviewed" : "returned", reviewedBy: a.user.id, reviewedAt: nowIso(), reviewComment: comment || null, version: r.version + 1 });
  audit(a, decision === "accept" ? "sitereport.accepted" : "sitereport.returned", "site_report", r.id, r.projectId, { date: r.reportDate });
}
const headcountOf = (r: SiteReport) => r.manpower.reduce((x, m) => x + m.headcount, 0);
function addProgress(a: Actor, projectId: string, b: { asOfDate: string; plannedPct: string; actualPct: string; forecastEndDate?: string | null; summary?: string | null; risks?: string | null }) {
  need(a, "progress.update"); needProject(a, projectId, "Project");
  if (b.asOfDate > today()) throw rule("FUTURE_DATE", "Progress cannot be reported for a future date.");
  const pl = Number(b.plannedPct), ac = Number(b.actualPct);
  if (![pl, ac].every((v) => v >= 0 && v <= 100)) throw rule("INVALID_PCT", "Percentages must be between 0 and 100.");
  db.progress.push({ id: newId("prg"), projectId, asOfDate: b.asOfDate, plannedPct: pl, actualPct: ac, forecastEndDate: b.forecastEndDate || null, summary: b.summary || null, risks: b.risks || null, createdBy: a.user.id, createdAt: nowIso() });
  audit(a, "progress.updated", "project", projectId, projectId, { planned: pl, actual: ac });
}
type Rag = "red" | "amber" | "green" | "none";
const worstRag = (...r: Rag[]): Rag => (r.includes("red") ? "red" : r.includes("amber") ? "amber" : r.includes("green") ? "green" : "none");
function overview(a: Actor) {
  need(a, "report.view");
  const t = today(), expected = lastWorkday(t), since = addDays(t, -30);
  const rows = db.projects.filter((p) => inScope(a, p.id) && ["planning", "active", "on_hold"].includes(p.status)).map((p) => {
    const attention: string[] = [];
    const pu = db.progress.filter((u) => u.projectId === p.id).sort((x, y) => y.asOfDate.localeCompare(x.asOfDate) || y.createdAt.localeCompare(x.createdAt))[0];
    let programme = null; let progRag: Rag = "none";
    if (pu) {
      const variance = minus(pu.actualPct, pu.plannedPct), stale = daysBetween(pu.asOfDate, t) > 14, lateFinish = !!pu.forecastEndDate && pu.forecastEndDate > p.plannedEndDate;
      progRag = variance <= -10 || lateFinish ? "red" : variance <= -3 || stale ? "amber" : "green";
      programme = { asOf: pu.asOfDate, plannedPct: m2(pu.plannedPct), actualPct: m2(pu.actualPct), variancePct: m2(variance), forecastEndDate: pu.forecastEndDate, plannedEndDate: p.plannedEndDate, lateFinish, stale, summary: pu.summary, risks: pu.risks, rag: progRag };
      if (variance < 0) attention.push(`Programme: ${pu.actualPct}% done vs ${pu.plannedPct}% planned`);
      if (lateFinish) attention.push(`Forecast finish ${pu.forecastEndDate}, after the planned ${p.plannedEndDate}`);
      if (stale) attention.push(`Progress not updated since ${pu.asOfDate}`);
    } else attention.push("No progress update recorded yet");
    let approvals = null; let apprRag: Rag = "none";
    if (can(a, "submittal.view")) {
      const mine = db.submittals.filter((s) => s.projectId === p.id && s.status !== "cancelled").map((s) => ({ s, st: subState(s, t) }));
      const withC = mine.filter((x) => x.st.ballInCourt === "consultant"), overdue = withC.filter((x) => x.st.overdue), maxOver = Math.max(0, ...overdue.map((x) => x.st.daysOverdue));
      const toResubmit = mine.filter((x) => ["revise_resubmit", "rejected"].includes(x.s.status)), late = mine.filter((x) => x.st.lateForSite);
      apprRag = !mine.length ? "none" : late.length || maxOver > 7 ? "red" : overdue.length || toResubmit.length ? "amber" : "green";
      approvals = { total: mine.length, withConsultant: withC.length, overdue: overdue.length, maxOverdueDays: maxOver, toResubmit: toResubmit.length, lateForSite: late.length, approved: mine.filter((x) => x.s.status === "approved").length, rag: apprRag };
      if (overdue.length) attention.push(`${overdue.length} submittal(s) overdue with the consultant (worst ${maxOver} days)`);
      if (toResubmit.length) attention.push(`${toResubmit.length} submittal(s) to revise and resubmit`);
      if (late.length) attention.push(`${late.length} submittal(s) not approved by the date site needs them`);
    }
    const pr = db.siteReports.filter((r) => r.projectId === p.id && r.reportDate >= since && ["submitted", "reviewed"].includes(r.status)).sort((x, y) => y.reportDate.localeCompare(x.reportDate));
    const lastDate = pr[0]?.reportDate ?? null;
    const missing = lastDate ? workdaysBetween(lastDate, expected) : workdaysBetween(since, expected);
    const headcount = pr.filter((r) => r.reportDate === lastDate).reduce((x, r) => x + headcountOf(r), 0);
    const delays = pr.filter((r) => r.reportDate > addDays(t, -7) && r.delayCause);
    const causes = [...new Set(delays.map((r) => r.delayCause!))];
    const incidents = pr.reduce((x, r) => x + r.safetyIncidents, 0);
    const siteRag: Rag = p.status !== "active" ? "none" : missing >= 3 ? "red" : missing > 0 || delays.length ? "amber" : "green";
    const safetyRag: Rag = !pr.length ? "none" : incidents > 0 ? "red" : "green";
    if (p.status === "active" && missing > 0) attention.push(lastDate ? `No site report since ${lastDate}` : "No site reports in the last 30 days");
    if (delays.length) attention.push(`Work held up on ${delays.length} day(s) this week: ${causes.join(", ")}`);
    if (incidents) attention.push(`${incidents} safety incident(s) in the last 30 days`);
    const latePos = db.pos.filter((o) => o.projectId === p.id && ["approved", "partially_received"].includes(o.status)).map((o) => o.promisedDate ?? o.requiredDate).filter((d): d is string => !!d && d < t);
    const worstLate = Math.max(0, ...latePos.map((d) => daysBetween(d, t)));
    const uncoveredSoon = db.mrs.filter((m) => m.projectId === p.id && m.status === "approved" && m.requiredDate <= addDays(t, 3)).flatMap((m) => m.lines).filter((l) => fulfilment(l.id).uncovered > 0).length;
    const supplyRag: Rag = worstLate > 7 ? "red" : latePos.length || uncoveredSoon ? "amber" : "green";
    if (latePos.length) attention.push(`${latePos.length} late deliveries (worst ${worstLate} days)`);
    if (uncoveredSoon) attention.push(`${uncoveredSoon} material request line(s) needed within 3 days and not covered`);
    const money = can(a, "cost.view") ? { contractValue: m2(p.contractValue), committed: m2(sum(drillRows(p.id, "committed").map((r) => r.value))), issuedCost: m2(sum(drillRows(p.id, "issued").map((r) => r.value))), notTracked: ["certified", "paid", "variations", "retention"] } : null;
    return { project: { id: p.id, code: p.code, name: p.name, status: p.status, clientName: p.clientName, startDate: p.startDate, plannedEndDate: p.plannedEndDate },
      overall: worstRag(progRag, apprRag, siteRag, safetyRag, supplyRag), programme, approvals,
      site: { lastReportDate: lastDate, missingWorkdays: missing, headcount, delayDays: delays.length, delayCauses: causes, rag: siteRag },
      safety: { incidents, rag: safetyRag }, supply: { lateDeliveries: latePos.length, worstLateDays: worstLate, uncoveredSoon, rag: supplyRag }, money, attention };
  });
  const rank = { red: 0, amber: 1, green: 2, none: 3 };
  rows.sort((x, y) => rank[x.overall] - rank[y.overall] || x.project.code.localeCompare(y.project.code));
  return { today: t, expectedReportDay: expected, totals: { projects: rows.length, red: rows.filter((r) => r.overall === "red").length, amber: rows.filter((r) => r.overall === "amber").length,
    headcount: rows.reduce((x, r) => x + r.site.headcount, 0), submittalsWithConsultant: rows.reduce((x, r) => x + (r.approvals?.withConsultant ?? 0), 0),
    submittalsOverdue: rows.reduce((x, r) => x + (r.approvals?.overdue ?? 0), 0), myApprovals: myPending(a).length }, projects: rows };
}

// ───────────── routing ─────────────
type Handler = (a: Actor, p: Record<string, string>, q: URLSearchParams, body: any) => unknown; // eslint-disable-line @typescript-eslint/no-explicit-any
const routes: [string, RegExp, string[], Handler][] = [];
const route = (method: string, path: string, h: Handler) => {
  const keys: string[] = [];
  const re = new RegExp(`^${path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; })}$`);
  routes.push([method, re, keys, h]);
};

route("GET", "/api/reference", (a) => ({
  projects: db.projects.filter((p) => inScope(a, p.id)).map(({ id, code, name, status }) => ({ id, code, name, status })),
  sites: db.sites.filter((s) => inScope(a, s.projectId)),
  locations: visibleLocations(a).map((l) => ({ ...l, projectCode: l.projectId ? project(l.projectId).code : null })),
  costCodes: db.costCodes,
  units: ["pcs", "box", "bag", "pallet", "roll", "drum", "m", "m2", "m3", "l", "kg", "t"].map((code) => ({ code, name: code, dimension: "" })),
  vatCodes: Object.entries(VAT_CODES).map(([code, v]) => ({ code, label: v.label, rate: v.rate })), vatVerified: VAT_VERIFIED,
  partners: db.partners,
}));
route("GET", "/api/items", () => db.items.map((i) => ({ id: i.id, code: i.code, description: i.description, category: i.category, baseUnit: i.baseUnit, purchaseUnit: i.purchaseUnit,
  conversions: i.conversions.map((c) => ({ unitCode: c.unitCode, baseUnitsPerUnit: q4(c.factor) })) })));
route("GET", "/api/suppliers", () => db.suppliers);
route("GET", "/api/material-requests", (a, _p, q) => {
  need(a, "mr.view");
  return db.mrs.filter((m) => inScope(a, m.projectId) && (!q.get("projectId") || m.projectId === q.get("projectId")) && (!q.get("status") || m.status === q.get("status")))
    .slice().reverse().map((m) => ({ id: m.id, number: m.number, status: m.status, revision: m.revision, requiredDate: m.requiredDate, projectCode: project(m.projectId).code,
      requesterName: userName(m.requestedBy), createdAt: m.createdAt, purpose: m.purpose, lineCount: m.lines.length }));
});
route("POST", "/api/material-requests", (a, _p, _q, b) => { const m = createMr(a, b); return { id: m.id, version: m.version }; });
route("GET", "/api/material-requests/:id", (a, p) => mrOut(a, getMrFor(a, p.id)));
route("PUT", "/api/material-requests/:id", (a, p, _q, b) => {
  const m = getMrFor(a, p.id);
  need(a, "mr.create");
  if (m.status !== "draft") throw rule("INVALID_STATE", "Only a draft can be edited.");
  if (b.version !== m.version) throw conflict();
  Object.assign(m, { siteId: b.siteId || null, requiredDate: b.requiredDate, purpose: b.purpose || null, lines: validateMrLines(b.lines), version: m.version + 1 });
  audit(a, "mr.update", "material_request", m.id, m.projectId, { number: m.number });
  return { id: m.id, version: m.version };
});
route("POST", "/api/material-requests/:id/submit", (a, p, _q, b) => { submitMr(a, p.id, b?.version); return { ok: true }; });
route("POST", "/api/material-requests/:id/revise", (a, p) => {
  const m = getMrFor(a, p.id);
  need(a, "mr.create");
  if (!["rejected", "pending_approval"].includes(m.status)) throw rule("INVALID_STATE", "Only pending or rejected requests can be revised.");
  supersede("material_request", m.id);
  m.status = "draft"; m.revision++; m.version++;
  audit(a, "mr.revise", "material_request", m.id, m.projectId, { number: m.number, revision: m.revision });
  return { ok: true };
});
route("POST", "/api/material-requests/:id/cancel", (a, p, _q, b) => { cancelMr(a, p.id, b?.reason); return { ok: true }; });
route("POST", "/api/material-request-lines/:id/reserve", (a, p, _q, b) => { reserve(a, p.id, b.locationId, b.qty); return { ok: true }; });
route("GET", "/api/approvals/mine", (a, _p, q) => myPending(a).filter((x) => !q.get("for") || x.docId === q.get("for")));
route("POST", "/api/approvals/:id/decide", (a, p, _q, b) => { decide(a, p.id, b.decision, b.comment); return { ok: true }; });
route("GET", "/api/purchase-orders", (a, _p, q) => {
  need(a, "po.view");
  return db.pos.filter((p) => inScope(a, p.projectId) && (!q.get("projectId") || p.projectId === q.get("projectId")) && (!q.get("status") || p.status === q.get("status")))
    .slice().reverse().map((p) => ({ id: p.id, number: p.number, status: p.status, revision: p.revision, projectCode: project(p.projectId).code,
      supplierName: db.suppliers.find((s) => s.id === p.supplierId)!.name, subtotal: can(a, "rates.view") ? m2(subtotal(p)) : null, promisedDate: p.promisedDate, requiredDate: p.requiredDate }));
});
route("POST", "/api/purchase-orders", (a, _p, _q, b) => { const p = createPo(a, b); return { id: p.id, version: p.version }; });
route("GET", "/api/purchase-orders/:id", (a, p) => poOut(a, getPoFor(a, p.id)));
route("PUT", "/api/purchase-orders/:id", (a, p, _q, b) => {
  const po = getPoFor(a, p.id);
  need(a, "po.create");
  if (po.status !== "draft") throw rule("INVALID_STATE", "Only a draft can be edited.");
  if (b.version !== po.version) throw conflict();
  Object.assign(po, { supplierId: b.supplierId, deliveryLocationId: b.deliveryLocationId, requiredDate: b.requiredDate || null, promisedDate: b.promisedDate || null,
    paymentTerms: b.paymentTerms || null, supplierQuoteRef: b.supplierQuoteRef || null, notes: b.notes || null, lines: poLines(a, po.projectId, b.lines, po.id), version: po.version + 1 });
  audit(a, "po.update", "purchase_order", po.id, po.projectId, { number: po.number });
  return { id: po.id, version: po.version };
});
route("POST", "/api/purchase-orders/:id/submit", (a, p, _q, b) => { submitPo(a, p.id, b?.version); return { ok: true }; });
route("POST", "/api/purchase-orders/:id/revise", (a, p, _q, b) => {
  const po = getPoFor(a, p.id);
  need(a, "po.create");
  if (db.receipts.some((g) => g.poId === po.id)) throw rule("HAS_RECEIPTS", "Deliveries have been received; short-close instead.");
  if (!b?.reason) throw rule("REASON_REQUIRED", "A reason is required.");
  supersede("purchase_order", po.id);
  po.status = "draft"; po.revision++; po.version++; po.approvedAt = null;
  audit(a, "po.revise", "purchase_order", po.id, po.projectId, { number: po.number, reason: b.reason });
  return { ok: true };
});
route("POST", "/api/purchase-orders/:id/short-close", (a, p, _q, b) => {
  const po = getPoFor(a, p.id);
  need(a, "po.create");
  if (!b?.reason) throw rule("REASON_REQUIRED", "A reason is required.");
  const received = db.receipts.some((g) => g.poId === po.id);
  for (const l of po.lines) l.cancelledBase = minus(l.qtyBase, poLineAccepted(l.id));
  supersede("purchase_order", po.id);
  po.status = received ? "closed" : "cancelled"; po.version++;
  audit(a, received ? "po.short_close" : "po.cancel", "purchase_order", po.id, po.projectId, { number: po.number, reason: b.reason });
  return { ok: true };
});
route("POST", "/api/purchase-orders/:id/receipts", (a, p, _q, b) => { const g = receive(a, p.id, b); return { receipt: { id: g.id, number: g.number } }; });
route("GET", "/api/stock", (a, _p, q) => stockRows(a, { locationId: q.get("locationId"), itemId: q.get("itemId") }));
route("GET", "/api/stock/card/:id", (a, p) => {
  need(a, "stock.view");
  const it = byId(db.items, p.id, "Item");
  const vis = new Set(visibleLocations(a).map((l) => l.id));
  const showCost = can(a, "cost.view");
  const running = new Map<string, Num>();
  const rows = db.movements.filter((m) => m.itemId === it.id && vis.has(m.locationId)).map((m) => {
    const k = `${m.locationId}|${m.status}`;
    running.set(k, plus(running.get(k) ?? 0, m.qty));
    return { seq: m.seq, date: m.date, type: m.type, location: loc(m.locationId).code, status: m.status, qtyDelta: q4(m.qty), balanceInBucket: q4(running.get(k)!), sourceNumber: m.sourceNumber,
      sourceType: m.sourceType, project: m.projectId ? project(m.projectId).code : null, costCode: m.costCodeId ? cc(m.costCodeId).code : null, postedBy: userName(m.postedBy) ?? "",
      note: m.note, unitCost: showCost && m.unitCost !== null ? q4(m.unitCost) : null, valueDelta: showCost && m.value !== null ? m2(m.value) : null };
  });
  return { item: { code: it.code, description: it.description, baseUnit: it.baseUnit }, rows: rows.reverse() };
});
route("POST", "/api/stock-issues", (a, _p, _q, b) => { const i = issueStock(a, b); return { issue: { id: i.id, number: i.number } }; });
route("GET", "/api/transfers", (a) => {
  need(a, "stock.view");
  const vis = new Set(visibleLocations(a).map((l) => l.id));
  return db.transfers.filter((t) => vis.has(t.fromId) || vis.has(t.toId)).slice().reverse().map((t) => ({ id: t.id, number: t.number, status: t.status, dispatchDate: t.dispatchDate, receivedDate: t.receivedDate,
    fromCode: loc(t.fromId).code, toCode: loc(t.toId).code, dispatchedByName: userName(t.dispatchedBy), openDiscrepancies: t.lines.filter((l) => l.discStatus === "open").length }));
});
route("GET", "/api/transfers/:id", (a, p) => {
  need(a, "stock.view");
  const t = byId(db.transfers, p.id, "Transfer");
  const vis = new Set(visibleLocations(a).map((l) => l.id));
  if (!vis.has(t.fromId) && !vis.has(t.toId)) throw notFound("Transfer");
  return { id: t.id, number: t.number, status: t.status, dispatchDate: t.dispatchDate, receivedDate: t.receivedDate, fromCode: loc(t.fromId).code, fromName: loc(t.fromId).name,
    toCode: loc(t.toId).code, toName: loc(t.toId).name, vehicleRef: t.vehicleRef, notes: t.notes, canReceive: can(a, "stock.transfer") && vis.has(t.toId),
    lines: t.lines.map((l) => ({ id: l.id, itemCode: item(l.itemId).code, itemDescription: item(l.itemId).description, baseUnit: item(l.itemId).baseUnit, qtyDispatched: q4(l.qty),
      qtyReceived: l.received === null ? null : q4(l.received), qtyDiscrepancy: l.short === null ? null : q4(l.short), discrepancyStatus: l.discStatus, discrepancyNote: l.note,
      mrNumber: l.mrLineId ? mrLine(l.mrLineId).mr.number : null })) };
});
route("POST", "/api/transfers", (a, _p, _q, b) => { const t = dispatch(a, b); return { transfer: { id: t.id, number: t.number } }; });
route("POST", "/api/transfers/:id/receive", (a, p, _q, b) => { receiveTransfer(a, p.id, b); return { ok: true }; });
route("POST", "/api/transfer-lines/:id/resolve", (a, p, _q, b) => { resolveLine(a, p.id, b.resolution, b.note); return { ok: true }; });
route("GET", "/api/dashboard", (a) => dashboard(a));
route("GET", "/api/reports/projects/:id", (a, p) => report(a, p.id));
route("GET", "/api/reports/projects/:id/drill", (a, p, q) => {
  need(a, "report.view", "cost.view");
  needProject(a, p.id, "Project");
  const rows = drillRows(p.id, q.get("metric") ?? "", q.get("costCodeId"));
  return { metric: q.get("metric"), rows, total: m2(sum(rows.map((r) => r.value))) };
});
route("GET", "/api/admin/users", (a) => {
  need(a, "admin.users");
  return db.users.map((u) => ({ id: u.id, email: u.email, fullName: u.fullName, jobTitle: u.jobTitle, isActive: true, lastLoginAt: u.lastLoginAt, roles: u.roles, projects: u.projects.map((p) => project(p).code) }));
});
route("GET", "/api/audit", (a) => {
  need(a, "audit.view");
  return db.audit.slice().reverse().slice(0, 200).map((r) => ({ id: r.id, at: r.at, userName: userName(r.userId), action: r.action, entityType: r.entityType, entityId: r.entityId,
    projectCode: r.projectId ? project(r.projectId).code : null, details: r.details }));
});
route("GET", "/api/history/:type/:id", (a, p) => db.audit.filter((r) => r.entityType === p.type && r.entityId === p.id && inScope(a, r.projectId)).map((r) => ({ id: r.id, at: r.at, action: r.action, details: r.details, userName: userName(r.userId) })));

route("GET", "/api/overview", (a) => overview(a));
route("POST", "/api/projects/:id/progress", (a, p, _q, b) => { addProgress(a, p.id, b); return { ok: true }; });
route("GET", "/api/submittals", (a, _p, q) => {
  need(a, "submittal.view");
  return db.submittals.filter((s) => inScope(a, s.projectId) && (!q.get("projectId") || s.projectId === q.get("projectId")) && (!q.get("type") || s.type === q.get("type")) && (!q.get("status") || s.status === q.get("status")))
    .slice().reverse().map(subRow).filter((r) => (!q.get("ball") || r.ballInCourt === q.get("ball")) && (q.get("overdue") !== "true" || r.overdue || r.lateForSite));
});
route("POST", "/api/submittals", (a, _p, _q, b) => createSub(a, b));
route("GET", "/api/submittals/:id", (a, p) => {
  const s = getSub(a, p.id);
  return { ...subRow(s), creatorName: userName(s.createdBy), items: s.itemIds.map((i) => ({ id: i, code: item(i).code, description: item(i).description })),
    revisions: db.revisions.filter((r) => r.submittalId === s.id).sort((x, y) => y.revNo - x.revNo).map((r) => {
      const c = db.codes.find((x) => x.id === r.codeId);
      return { ...r, code: c?.code ?? null, codeLabel: c?.label ?? null, submittedByName: userName(r.submittedBy), recordedByName: userName(r.recordedBy) };
    }),
    codes: db.codes.filter((c) => c.projectId === s.projectId).sort((x, y) => x.sortOrder - y.sortOrder) };
});
route("PUT", "/api/submittals/:id", (a, p, _q, b) => {
  need(a, "submittal.manage");
  const s = getSub(a, p.id);
  if (DONE_SUB.includes(s.status)) throw rule("INVALID_STATE", "Approved, closed or cancelled submittals cannot be edited.");
  if (b.version !== s.version) throw conflict();
  Object.assign(s, { type: b.type, title: b.title, discipline: b.discipline, specSection: b.specSection || null, area: b.area || null, subcontractorId: b.subcontractorId || null,
    consultantId: b.consultantId || s.consultantId, requiredBy: b.requiredBy || null, itemIds: [...new Set((b.itemIds ?? []) as string[])], version: s.version + 1 });
  audit(a, "submittal.updated", "submittal", s.id, s.projectId, { number: s.number });
  return { id: s.id, version: s.version };
});
route("POST", "/api/submittals/:id/submit", (a, p, _q, b) => { sendSub(a, p.id, b); return { ok: true }; });
route("POST", "/api/submittals/:id/response", (a, p, _q, b) => { respondSub(a, p.id, b); return { ok: true }; });
route("POST", "/api/submittals/:id/cancel", (a, p, _q, b) => {
  need(a, "submittal.manage");
  const s = getSub(a, p.id);
  if (DONE_SUB.includes(s.status)) throw rule("INVALID_STATE", "This submittal is already approved, closed or cancelled.");
  s.status = "cancelled"; s.version++;
  audit(a, "submittal.cancelled", "submittal", s.id, s.projectId, { number: s.number, reason: b?.reason });
  return { ok: true };
});
route("GET", "/api/projects/:id/submittal-codes", (a, p) => { need(a, "submittal.view"); needProject(a, p.id, "Project"); return db.codes.filter((c) => c.projectId === p.id).sort((x, y) => x.sortOrder - y.sortOrder); });
route("PUT", "/api/projects/:id/submittal-codes", (a, p, _q, b) => setCodes(a, p.id, b.codes));
route("GET", "/api/site-reports", (a, _p, q) => {
  need(a, "project.view");
  return db.siteReports.filter((r) => inScope(a, r.projectId) && (!q.get("projectId") || r.projectId === q.get("projectId")) && (!q.get("from") || r.reportDate >= q.get("from")!))
    .sort((x, y) => y.reportDate.localeCompare(x.reportDate) || project(x.projectId).code.localeCompare(project(y.projectId).code))
    .map((r) => ({ id: r.id, projectId: r.projectId, projectCode: project(r.projectId).code, siteName: db.sites.find((s) => s.id === r.siteId)?.name ?? null, reportDate: r.reportDate, status: r.status,
      headcount: headcountOf(r), delayCause: r.delayCause, safetyIncidents: r.safetyIncidents, authorName: userName(r.createdBy), summary: r.workDone.slice(0, 140) }));
});
route("POST", "/api/site-reports", (a, _p, _q, b) => { const r = createReport(a, b); return { id: r.id, version: r.version }; });
route("GET", "/api/site-reports/:id", (a, p) => {
  const r = getReport(a, p.id), pr = project(r.projectId);
  return { ...r, projectCode: pr.code, projectName: pr.name, siteName: db.sites.find((s) => s.id === r.siteId)?.name ?? null, authorName: userName(r.createdBy), reviewerName: userName(r.reviewedBy),
    manpower: r.manpower.map((m) => ({ ...m, companyName: db.partners.find((c) => c.id === m.companyId)?.name ?? null })), totalHeadcount: headcountOf(r) };
});
route("PUT", "/api/site-reports/:id", (a, p, _q, b) => {
  need(a, "sitereport.create");
  const r = getReport(a, p.id);
  if (!["draft", "returned"].includes(r.status)) throw rule("INVALID_STATE", "Only a draft or returned report can be edited.");
  if (b.version !== r.version) throw conflict();
  checkReport(b);
  Object.assign(r, { siteId: b.siteId ?? r.siteId, ...reportFields(b), version: r.version + 1 });
  audit(a, "sitereport.updated", "site_report", r.id, r.projectId, { date: r.reportDate });
  return { id: r.id, version: r.version };
});
route("POST", "/api/site-reports/:id/submit", (a, p) => { submitReport(a, p.id); return { ok: true }; });
route("POST", "/api/site-reports/:id/review", (a, p, _q, b) => { reviewReport(a, p.id, b.decision, b.comment); return { ok: true }; });

export const DEMO_PASSWORD = "Demo@2026!";

/** Answers one API call the way the real server would (status code + JSON body). */
export function handle(method: string, url: string, body: unknown): { status: number; body: unknown } {
  const u = new URL(url, "http://preview.local");
  try {
    if (u.pathname === "/api/auth/login") {
      const b = body as { email?: string; password?: string };
      const user = db.users.find((x) => x.email === String(b.email ?? "").toLowerCase().trim());
      if (!user || b.password !== DEMO_PASSWORD) throw new HttpError(401, "INVALID_LOGIN", "Email or password is incorrect.");
      session = user.id; user.lastLoginAt = nowIso();
      return { status: 200, body: me(actorOf(user)) };
    }
    if (u.pathname === "/api/auth/logout") { session = null; return { status: 200, body: { ok: true } }; }
    const user = db.users.find((x) => x.id === session);
    if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Please sign in.");
    const a = actorOf(user);
    if (u.pathname === "/api/auth/me") return { status: 200, body: me(a) };
    for (const [m, re, keys, h] of routes) {
      if (m !== method) continue;
      const hit = re.exec(u.pathname);
      if (!hit) continue;
      const params = Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(hit[i + 1])]));
      return { status: 200, body: h(a, params, u.searchParams, body) };
    }
    throw new HttpError(404, "NOT_FOUND", "This part is not available in the preview.");
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { error: { code: e.code, message: e.message } } };
    console.error(e);
    return { status: 500, body: { error: { code: "PREVIEW_ERROR", message: (e as Error).message } } };
  }
}

export const signInAs = (email: string) => { const u = db.users.find((x) => x.email === email); session = u?.id ?? null; if (u) u.lastLoginAt = nowIso(); };
export const signedIn = () => !!session;

// ───────────── synthetic demo data (mirrors server/db/seed.ts) ─────────────
export function seed() {
  const t = today();
  const sup = (code: string, name: string, trn: string | null, paymentTerms: string | null) => { const s = { id: newId("sup"), code, name, trn, paymentTerms }; db.suppliers.push(s); return s; };
  const supGbm = sup("SUP-DEMO-01", "Gulf Building Materials Trading (Demo)", "100000000000001", "30 days from invoice");
  const supTiles = sup("SUP-DEMO-02", "Emirates Tiles & Ceramics (Demo)", "100000000000002", "45 days");
  sup("SUP-DEMO-03", "Desert Steel Supplies (Demo)", "100000000000003", "Advance 20%, balance 30 days");
  sup("SUP-DEMO-04", "Oasis Electrical Trading (Demo)", null, "30 days");
  const supLand = sup("SUP-DEMO-05", "Green Landscape Supplies (Demo)", null, "Cash on delivery");

  const partner = (name: string, isSubcontractor: boolean, isConsultant: boolean) => { const c = { id: newId("co"), name, isSubcontractor, isConsultant }; db.partners.push(c); return c; };
  const atlas = partner("Atlas Engineering Consultants (Demo)", false, true);
  const coastline = partner("Coastline Landscape Architects (Demo)", false, true);
  const mep = partner("Al Noor Electromechanical (Demo)", true, false);
  const block = partner("Pioneer Blockwork Contracting (Demo)", true, false);
  const land = partner("Desert Rose Landscaping (Demo)", true, false);
  const alu = partner("Gulf Aluminium & Glazing (Demo)", true, false);
  const proj = (code: string, name: string, contractValue: Num, clientName: string, start: number, end: number, consultantId: string) => {
    const p = { id: newId("prj"), code, name, status: "active", contractValue, clientName, startDate: addDays(t, start), plannedEndDate: addDays(t, end), consultantId, reviewDays: 14 };
    db.projects.push(p); return p;
  };
  const p101 = proj("DEMO-101", "Marina Residential Tower — Interior Fit-out (Demo)", 18500000, "Marina Heights Developments (Demo Client)", -120, 240, atlas.id);
  const p102 = proj("DEMO-102", "Palm Grove Villa — Landscape, Hardscape & Pool (Demo)", 2750000, "Palm Grove Private Owner (Demo Client)", -60, 150, coastline.id);
  const p103 = proj("DEMO-103", "Al Quoz Warehouse — MEP Package (Demo)", 6200000, "Al Quoz Logistics Park (Demo Client)", -20, 200, atlas.id);
  const site = (projectId: string, code: string, name: string) => { const s = { id: newId("site"), projectId, code, name }; db.sites.push(s); return s; };
  const s101 = site(p101.id, "TWR", "Tower — Levels 1–30"); const s102 = site(p102.id, "VILLA", "Villa plot"); const s103 = site(p103.id, "WH1", "Warehouse building 1");
  const mkLoc = (code: string, name: string, type: Location["type"], projectId: string | null = null) => { const l = { id: newId("loc"), code, name, type, projectId }; db.locations.push(l); return l; };
  mkLoc("TRANSIT", "Goods in transit (system)", "transit");
  const wh = mkLoc("WH-CENTRAL", "Central Warehouse — Al Quoz (Demo)", "warehouse");
  const ss101 = mkLoc("SS-101", "Site store — Marina Tower", "site_store", p101.id);
  const ss102 = mkLoc("SS-102", "Site store — Palm Grove Villa", "site_store", p102.id);
  mkLoc("SS-103", "Site store — Al Quoz Warehouse", "site_store", p103.id);

  for (const [code, name, category] of [["03-300", "Cast-in-place concrete"], ["03-210", "Reinforcement steel"], ["04-220", "Concrete blockwork"], ["06-100", "Rough carpentry / formwork"],
    ["09-210", "Gypsum board & partitions"], ["09-300", "Tiling"], ["09-900", "Painting & coatings"], ["13-110", "Swimming pools"], ["22-110", "Plumbing piping"], ["26-050", "Electrical cabling"],
    ["32-140", "Hardscape & paving"], ["32-840", "Irrigation"], ["32-900", "Softscape / planting"]].map(([c, n]) => [c, n, "material"]))
    db.costCodes.push({ id: newId("cc"), code, name, category });
  const ccId = (code: string) => db.costCodes.find((c) => c.code === code)!.id;

  const mkUser = (email: string, fullName: string, jobTitle: string, roles: string[], projects: string[] = []) => { const u = { id: newId("usr"), email, fullName, jobTitle, roles, projects, lastLoginAt: null }; db.users.push(u); return actorOf(u); };
  mkUser("admin@demo.edge.test", "Demo Administrator", "System administrator", ["admin"]);
  mkUser("director@demo.edge.test", "Demo Director", "Managing Director", ["director"]);
  const ops = mkUser("ops@demo.edge.test", "Demo Operations Manager", "Operations Manager", ["operations_manager"]);
  const pmA = mkUser("pm.marina@demo.edge.test", "Demo PM Marina", "Project Manager", ["project_manager"], [p101.id]);
  const pmB = mkUser("pm.villa@demo.edge.test", "Demo PM Villa", "Project Manager", ["project_manager"], [p102.id, p103.id]);
  const se = mkUser("engineer.marina@demo.edge.test", "Demo Site Engineer Marina", "Site Engineer", ["site_engineer"], [p101.id]);
  mkUser("foreman.marina@demo.edge.test", "Demo Foreman Marina", "Foreman", ["foreman"], [p101.id]);
  const seB = mkUser("engineer.villa@demo.edge.test", "Demo Site Engineer Villa", "Site Engineer", ["site_engineer"], [p102.id]);
  const proc = mkUser("procurement@demo.edge.test", "Demo Procurement Officer", "Procurement Officer", ["procurement_officer"]);
  const store = mkUser("stores@demo.edge.test", "Demo Central Storekeeper", "Storekeeper", ["storekeeper"], [p101.id, p102.id, p103.id]);
  mkUser("qs@demo.edge.test", "Demo Quantity Surveyor", "Quantity Surveyor", ["quantity_surveyor"], [p101.id, p102.id]);
  mkUser("accounts@demo.edge.test", "Demo Accountant", "Accountant", ["accountant"]);
  mkUser("viewer@demo.edge.test", "Demo Management Viewer", "Management", ["management_viewer"]);
  const dc = mkUser("dc@demo.edge.test", "Demo Document Controller", "Document Controller", ["document_controller"], [p101.id, p102.id, p103.id]);

  const mkItem = (code: string, description: string, category: string, baseUnit: string, purchaseUnit: string | null, reorderLevel: Num | null, conv: [string, Num][] = []) => {
    const i = { id: newId("itm"), code, description, category, baseUnit, purchaseUnit, reorderLevel, conversions: conv.map(([unitCode, factor]) => ({ unitCode, factor })) };
    db.items.push(i); return i;
  };
  const gyp = mkItem("GYP-BRD-125", "Gypsum board 12.5 mm, 1200×2400, standard", "Drywall", "pcs", "pcs", 50);
  const blk = mkItem("BLK-HOL-200", "Hollow concrete block 200 mm", "Masonry", "pcs", "pallet", 500, [["pallet", 90]]);
  const cem = mkItem("CEM-OPC-50", "Cement OPC, 50 kg bag", "Cement", "bag", "bag", 100, [["kg", 0.02]]);
  const paint = mkItem("PNT-EMU-WHT", "Interior emulsion paint, white", "Paint", "l", "drum", 100, [["drum", 18]]);
  const tile = mkItem("TIL-PRC-600", "Porcelain floor tile 600×600, matt", "Tiles", "m2", "box", 40, [["box", 1.44]]);
  const ppr = mkItem("PPR-PIPE-25", "PPR pipe PN20, 25 mm", "Plumbing", "m", "pcs", 200, [["pcs", 4]]);
  const cable = mkItem("CBL-CU-2.5", "Cu cable 2.5 mm² single core", "Electrical", "m", "roll", 500, [["roll", 100]]);
  const rebar = mkItem("STL-RBR-12", "Rebar 12 mm, grade 60", "Steel", "kg", "t", 2000, [["t", 1000]]);
  const paver = mkItem("PVR-INT-80", "Interlock paver 80 mm, grey", "Hardscape", "m2", "m2", 50);
  const drip = mkItem("IRR-DRP-16", "Drip line 16 mm, 30 cm spacing", "Irrigation", "m", "roll", 300, [["roll", 100]]);
  mkItem("POL-CHL-GRN", "Pool chlorine granules", "Pool chemicals", "kg", "kg", 25);
  mkItem("PLY-18-MR", "Plywood 18 mm, moisture resistant", "Timber", "pcs", "pcs", 30);

  const od = addDays(t, -90);
  for (const [it, l, q, c] of [[gyp, wh, 40, 21.5], [blk, wh, 1800, 3.1], [cem, wh, 260, 16.75], [paint, wh, 540, 9.8], [tile, wh, 120, 38], [ppr, wh, 160, 7.25],
    [cable, wh, 3500, 1.95], [rebar, wh, 6500, 2.65], [paver, wh, 30, 42], [drip, wh, 1200, 1.15], [cem, ss101, 35, 16.75]] as [Item, Location, Num, Num][]) opening(ops, it.id, l.id, q, c, od);

  const approveAll = (approver: Actor, docId: string) => { for (const p of myPending(approver)) if (p.docId === docId) decide(approver, p.requestId, "approve", "Approved (demo)"); };

  // 1) 100 gypsum boards: 40 reserved from the warehouse, PO for 60, 50 delivered with 5 rejected, 30 issued.
  const mr1 = createMr(se, { projectId: p101.id, siteId: s101.id, requiredDate: addDays(t, 3), purpose: "Level 12 partitions (demo)",
    lines: [{ itemId: gyp.id, qty: 100, costCodeId: ccId("09-210") }, { itemId: cem.id, qty: 20, costCodeId: ccId("04-220") }] });
  submitMr(se, mr1.id); approveAll(pmA, mr1.id);
  reserve(store, mr1.lines[0].id, wh.id, 40); reserve(store, mr1.lines[1].id, ss101.id, 20);
  const po1 = createPo(proc, { projectId: p101.id, supplierId: supGbm.id, deliveryLocationId: ss101.id, requiredDate: addDays(t, 2), promisedDate: addDays(t, -1), paymentTerms: "30 days from invoice",
    supplierQuoteRef: "Q-DEMO-5512", lines: [{ itemId: gyp.id, mrLineId: mr1.lines[0].id, costCodeId: ccId("09-210"), unitCode: "pcs", qty: 60, unitPrice: 22, vatCode: "SR" }] });
  submitPo(proc, po1.id); approveAll(pmA, po1.id);
  receive(se, po1.id, { idempotencyKey: "demo-grn-po1-a", deliveryNoteRef: "DN-DEMO-77812", receivedDate: addDays(t, -1),
    lines: [{ poLineId: po1.lines[0].id, qtyReceived: "50", qtyRejected: "5", rejectionReason: "Broken edges on delivery" }] });
  issueStock(store, { idempotencyKey: "demo-iss-1", locationId: ss101.id, issuedTo: "Drywall crew — Demo Foreman", lines: [{ mrLineId: mr1.lines[0].id, qty: 30 }, { mrLineId: mr1.lines[1].id, qty: 12 }] });
  // 2) Paint request waiting for PM approval.
  const mr2 = createMr(se, { projectId: p101.id, siteId: s101.id, requiredDate: addDays(t, 7), purpose: "Levels 8–10 first coat (demo)",
    lines: [{ itemId: paint.id, qty: 360, costCodeId: ccId("09-900") }, { itemId: tile.id, qty: 86.4, costCodeId: ccId("09-300") }] });
  submitMr(se, mr2.id);
  // 3) Draft not yet submitted.
  createMr(se, { projectId: p101.id, siteId: s101.id, requiredDate: addDays(t, 14), purpose: "Bathroom pipework L14 (draft, demo)", lines: [{ itemId: ppr.id, qty: 240, costCodeId: ccId("22-110") }] });
  // 4) Villa: approved request, PO overdue, drip line in transit.
  const mr4 = createMr(seB, { projectId: p102.id, siteId: s102.id, requiredDate: addDays(t, -2), purpose: "Driveway paving & irrigation (demo)",
    lines: [{ itemId: paver.id, qty: 180, costCodeId: ccId("32-140") }, { itemId: drip.id, qty: 600, costCodeId: ccId("32-840") }] });
  submitMr(seB, mr4.id); approveAll(pmB, mr4.id);
  reserve(store, mr4.lines[0].id, wh.id, 30);
  const po4 = createPo(proc, { projectId: p102.id, supplierId: supLand.id, deliveryLocationId: ss102.id, requiredDate: addDays(t, -3), promisedDate: addDays(t, -4),
    lines: [{ itemId: paver.id, mrLineId: mr4.lines[0].id, costCodeId: ccId("32-140"), unitCode: "m2", qty: 150, unitPrice: 39.5, vatCode: "SR" }] });
  submitPo(proc, po4.id); approveAll(pmB, po4.id);
  reserve(store, mr4.lines[1].id, wh.id, 600);
  dispatch(store, { idempotencyKey: "demo-trf-1", fromLocationId: wh.id, toLocationId: ss102.id, vehicleRef: "Pickup D-DEMO-12", notes: "Demo transfer", lines: [{ itemId: drip.id, qty: 600, mrLineId: mr4.lines[1].id }] });
  // 5) Tile PO needing two approval levels (PM approved, waiting for the Operations Manager).
  const mr5 = createMr(se, { projectId: p101.id, siteId: s101.id, requiredDate: addDays(t, 21), purpose: "Corridor flooring L1–L6 (demo)", lines: [{ itemId: tile.id, qty: 1440, costCodeId: ccId("09-300") }] });
  submitMr(se, mr5.id); approveAll(pmA, mr5.id);
  const po5 = createPo(proc, { projectId: p101.id, supplierId: supTiles.id, deliveryLocationId: wh.id, requiredDate: addDays(t, 18), promisedDate: addDays(t, 16),
    lines: [{ itemId: tile.id, mrLineId: mr5.lines[0].id, costCodeId: ccId("09-300"), unitCode: "box", qty: 1000, unitPrice: 52, vatCode: "SR" }] });
  submitPo(proc, po5.id); approveAll(pmA, po5.id);
  // 6) Cancelled request.
  const mr6 = createMr(se, { projectId: p101.id, requiredDate: addDays(t, 5), purpose: "Duplicate entry (demo)", lines: [{ itemId: blk.id, qty: 90, costCodeId: ccId("04-220") }] });
  cancelMr(se, mr6.id, "Duplicate of another request");

  // ── Project control (mirrors projectControlDemo in server/db/seed.ts) ──
  const atlasCodes = [{ code: "A", label: "Approved", outcome: "approved" }, { code: "B", label: "Approved as noted", outcome: "approved_as_noted" },
    { code: "C", label: "Revise and resubmit", outcome: "revise_resubmit" }, { code: "D", label: "Rejected", outcome: "rejected" }];
  const c101 = setCodes(pmA, p101.id, atlasCodes), c103 = setCodes(pmB, p103.id, atlasCodes);
  const c102 = setCodes(pmB, p102.id, [{ code: "1", label: "No objection", outcome: "approved" }, { code: "2", label: "No objection with comments", outcome: "approved_as_noted" },
    { code: "3", label: "Revise and resubmit", outcome: "revise_resubmit" }, { code: "4", label: "Not accepted", outcome: "rejected" }, { code: "FI", label: "For information", outcome: "for_information" }]);
  type Step = ["submit", number] | ["respond", number, string, string?];
  const subm = (projectId: string, codes: SubCode[], input: Omit<SubIn, "projectId">, steps: Step[]) => {
    const x = createSub(dc, { projectId, ...input });
    for (const st of steps) {
      if (st[0] === "submit") sendSub(dc, x.id, { submittedDate: addDays(t, st[1]), transmittalRef: `TR-${x.number.slice(-3)}` });
      else respondSub(dc, x.id, { codeId: codes.find((c) => c.code === st[2])!.id, returnedDate: addDays(t, st[1]), consultantComments: st[3] ?? null, reviewerName: "Resident Engineer (Demo)" });
    }
  };
  subm(p101.id, c101, { type: "shop_drawing", title: "HVAC ducting shop drawings, Levels 3–5", discipline: "mechanical", subcontractorId: mep.id, area: "Levels 3–5", requiredBy: addDays(t, 6) }, [["submit", -24]]);
  subm(p101.id, c101, { type: "material", title: "Interior emulsion paint, technical data sheet", discipline: "architectural", itemIds: [paint.id], requiredBy: addDays(t, 10) }, [["submit", -5]]);
  subm(p101.id, c101, { type: "sample", title: "Porcelain floor tile 600×600 sample", discipline: "architectural", itemIds: [tile.id], specSection: "09 30 00" },
    [["submit", -18], ["respond", -10, "C", "Provide the matt finish option and a grout colour sample"], ["submit", -8], ["respond", -2, "B", "Matt finish approved; grout colour 'light grey'"]]);
  subm(p101.id, c101, { type: "mockup", title: "Typical apartment bathroom mock-up", discipline: "architectural", area: "Level 2, apartment 204", requiredBy: addDays(t, 5) },
    [["submit", -6], ["respond", -3, "C", "Adjust tile setting-out at the niche; redo silicone joints"]]);
  subm(p101.id, c101, { type: "method_statement", title: "Blockwork method statement", discipline: "civil", subcontractorId: block.id }, [["submit", -30], ["respond", -22, "A"]]);
  subm(p101.id, c101, { type: "shop_drawing", title: "Aluminium windows shop drawings", discipline: "architectural", subcontractorId: alu.id, requiredBy: addDays(t, 25) }, []);
  subm(p102.id, c102, { type: "material", title: "Irrigation drip line material submittal", discipline: "landscape", itemIds: [drip.id], subcontractorId: land.id }, [["submit", -25], ["respond", -15, "1"]]);
  subm(p102.id, c102, { type: "sample", title: "Pool tiles and coping stone samples", discipline: "architectural", requiredBy: addDays(t, -1) }, [["submit", -16]]);
  subm(p102.id, c102, { type: "sample", title: "Interlock paver colour sample", discipline: "landscape", itemIds: [paver.id] }, [["submit", -20], ["respond", -12, "2", "Charcoal border, grey field"]]);
  subm(p103.id, c103, { type: "shop_drawing", title: "Cable tray and trunking routes", discipline: "electrical", subcontractorId: mep.id, itemIds: [cable.id] }, [["submit", -3]]);
  subm(p103.id, c103, { type: "material", title: "Chilled water pipe and insulation", discipline: "mechanical", subcontractorId: mep.id }, [["submit", -14], ["respond", -6, "A"]]);

  const workdays: string[] = [];
  for (let d = addDays(t, -1); workdays.length < 6; d = addDays(d, -1)) if (WORKDAYS.includes(weekday(d))) workdays.push(d);
  const daily = (author: Actor, reviewer: Actor | null, projectId: string, siteId: string, date: string, workDone: string, manpower: { trade: string; companyId?: string; headcount: number }[], extra: Partial<ReportIn> = {}) => {
    const r = createReport(author, { projectId, siteId, reportDate: date, weather: "Clear, 33–36 °C", workDone, manpower, ...extra });
    submitReport(author, r.id);
    if (reviewer) reviewReport(reviewer, r.id, "accept");
  };
  for (const [i, d] of workdays.entries()) {
    daily(se, i === 0 ? null : pmA, p101.id, s101.id, d, `Blockwork L${9 + (i % 3)} corridors; MEP first fix L4–5; plastering L2–3 (demo)`, [
      { trade: "Mason", companyId: block.id, headcount: 18 - i }, { trade: "Electrician", companyId: mep.id, headcount: 9 }, { trade: "Plumber", companyId: mep.id, headcount: 6 },
      { trade: "Plasterer", headcount: 10 }, { trade: "Helper", headcount: 14 },
    ], i === 1 ? { delayCause: "material", issues: "Block delivery arrived at 11:00; masons idle 2 hours" } : i === 3 ? { delayCause: "consultant", issues: "Waiting for the bathroom mock-up inspection" } : {});
  }
  for (const d of workdays.slice(3)) {
    daily(seB, pmB, p102.id, s102.id, d, "Driveway sub-base compaction; irrigation sleeves; pool shell waterproofing (demo)", [
      { trade: "Landscaper", companyId: land.id, headcount: 8 }, { trade: "Mason", headcount: 4 }, { trade: "Helper", headcount: 6 },
    ], d === workdays[4] ? { safetyIncidents: 1, safetyNotes: "Minor hand cut, first aid given on site; toolbox talk held (demo)" } : {});
  }
  for (const d of workdays) daily(pmB, ops, p103.id, s103.id, d, "Cable tray installation zone B; chilled water risers (demo)", [{ trade: "Electrician", companyId: mep.id, headcount: 12 }, { trade: "Pipe fitter", companyId: mep.id, headcount: 7 }]);

  addProgress(pmA, p101.id, { asOfDate: addDays(t, -2), plannedPct: "46", actualPct: "41", forecastEndDate: p101.plannedEndDate, summary: "Blockwork 2 floors behind; MEP first fix on plan.", risks: "Bathroom mock-up rejected once; tile approval needed before L6 finishes." });
  addProgress(pmB, p102.id, { asOfDate: addDays(t, -3), plannedPct: "62", actualPct: "49", forecastEndDate: addDays(p102.plannedEndDate, 21), summary: "Pool works waiting for tile and coping approval.", risks: "Client may delay handover acceptance; pool tile sample overdue with consultant." });
  addProgress(pmB, p103.id, { asOfDate: addDays(t, -1), plannedPct: "12", actualPct: "13", summary: "Cable tray ahead of plan." });
}

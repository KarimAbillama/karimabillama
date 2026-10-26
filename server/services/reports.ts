/**
 * Project material report and the action dashboard.
 *
 * KPI definitions (all AED, excluding VAT, "as at" the moment the report is generated):
 *  - committed        Approved purchase-order value (statuses approved / partially_received / received / closed)
 *                     less the value of cancelled balances.
 *  - receivedValue    Accepted goods-receipt quantity × PO unit cost. Inventory, not yet project cost.
 *  - openCommitment   committed − receivedValue (ordered but not yet accepted).
 *  - issuedCost       Value of stock issued to the project's cost codes (moving average cost at issue).
 *                     This is the project's recognised material cost in Phase 1.
 *  - siteStockValue   Available stock in the project's site stores × current average cost.
 *  - Invoiced, paid, labour, subcontract, budget and forecast are NOT tracked in Phase 1 and are
 *    returned as null with a reason — never as zero.
 * Every figure has a drill-down that returns the source rows whose sum equals the figure.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client.js";
import { projects, rfis, siteReports, submittalRevisions, submittals } from "../db/schema.js";
import { type Actor, can, canAccessProject, requirePerm, requireProject } from "../auth/actor.js";
import { businessToday } from "../lib/dates.js";
import { lastWorkday } from "../lib/workdays.js";
import { type Decimal, dec, m2, q4, sum } from "../lib/decimal.js";
import { notFound, rule } from "../lib/errors.js";
import { myPendingApprovals } from "./approvals.js";
import { lineFulfilment } from "./materialRequests.js";
import { listLocations, stockPosition } from "./inventory.js";
import { submittalState } from "./submittals.js";
import { rfiState } from "./rfis.js";

const COMMITTED_STATUSES = sql`('approved','partially_received','received','closed')`;
const NOT_TRACKED = "Not tracked in Phase 1";
/** Human-readable quantity for messages (no trailing zeros). */
const qtyText = (v: Decimal.Value) => dec(v).toDecimalPlaces(4).toString();

export type DrillMetric = "committed" | "received" | "issued";

/** Source rows for a metric; the report totals are computed from exactly these rows. */
export async function drillRows(db: DbOrTx, projectId: string, metric: DrillMetric, costCodeId?: string) {
  const cc = costCodeId ? sql`and cc.id = ${costCodeId}` : sql``;
  if (metric === "committed") {
    const r = await db.execute<Record<string, string>>(sql`
      select po.id as "docId", po.number as "docNumber", 'purchase_order' as "docType", pl.line_no as "lineNo", po.status,
        i.code as "itemCode", i.description as "itemDescription", cc.id as "costCodeId", cc.code as "costCode",
        (pl.qty_base - pl.qty_cancelled_base)::numeric(18,4) as "qtyBase", i.base_unit as "baseUnit",
        round(pl.line_net * (pl.qty_base - pl.qty_cancelled_base) / pl.qty_base, 2) as value,
        to_char(po.approved_at at time zone 'Asia/Dubai', 'YYYY-MM-DD') as date
      from purchase_order_lines pl
      join purchase_orders po on po.id = pl.purchase_order_id
      join items i on i.id = pl.item_id
      join cost_codes cc on cc.id = pl.cost_code_id
      where po.project_id = ${projectId} and po.status in ${COMMITTED_STATUSES} ${cc}
      order by po.number, pl.line_no`);
    return r.rows;
  }
  if (metric === "received") {
    const r = await db.execute<Record<string, string>>(sql`
      select g.id as "docId", g.number as "docNumber", 'goods_receipt' as "docType", pl.line_no as "lineNo", po.number as "poNumber",
        i.code as "itemCode", i.description as "itemDescription", cc.id as "costCodeId", cc.code as "costCode",
        gl.qty_accepted_base as "qtyBase", i.base_unit as "baseUnit", round(gl.qty_accepted_base * gl.unit_cost_base, 2) as value, g.received_date as date
      from goods_receipt_lines gl
      join goods_receipts g on g.id = gl.goods_receipt_id
      join purchase_order_lines pl on pl.id = gl.po_line_id
      join purchase_orders po on po.id = g.purchase_order_id
      join items i on i.id = gl.item_id
      join cost_codes cc on cc.id = pl.cost_code_id
      where g.project_id = ${projectId} and gl.qty_accepted_base > 0 ${cc}
      order by g.number, pl.line_no`);
    return r.rows;
  }
  const r = await db.execute<Record<string, string>>(sql`
    select m.source_id as "docId", m.source_number as "docNumber", m.source_type as "docType", m.seq as "lineNo",
      i.code as "itemCode", i.description as "itemDescription", cc.id as "costCodeId", cc.code as "costCode",
      (-m.qty_delta)::numeric(18,4) as "qtyBase", i.base_unit as "baseUnit", (-m.value_delta)::numeric(18,2) as value, m.movement_date as date
    from stock_movements m
    join items i on i.id = m.item_id
    join cost_codes cc on cc.id = m.cost_code_id
    where m.project_id = ${projectId} and m.movement_type in ('issue','issue_return') ${cc}
    order by m.seq`);
  return r.rows;
}

export async function projectReport(db: DbOrTx, actor: Actor, projectId: string) {
  requirePerm(actor, "report.view");
  requireProject(actor, projectId, "Project");
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw notFound("Project");
  const showCost = can(actor, "cost.view");
  const generatedAt = new Date();

  const [committedRows, receivedRows, issuedRows] = await Promise.all([
    drillRows(db, projectId, "committed"), drillRows(db, projectId, "received"), drillRows(db, projectId, "issued"),
  ]);
  const total = (rows: Record<string, string>[]) => m2(sum(rows.map((r) => r.value)));
  const committed = total(committedRows), received = total(receivedRows), issued = total(issuedRows);

  const pending = await db.execute<{ v: string | null; n: number }>(sql`
    select coalesce(sum(subtotal),0) as v, count(*)::int as n from purchase_orders where project_id = ${projectId} and status = 'pending_approval'`);
  const siteStock = (await stockPosition(db, actor, { projectId })).filter((r) => r.locationType === "site_store");
  const siteStockValue = showCost ? m2(sum(siteStock.map((s) => s.availableValue ?? 0))) : null;

  // by cost code
  const byCc = new Map<string, { costCodeId: string; costCode: string; committed: string; received: string; issued: string }>();
  const add = (rows: Record<string, string>[], key: "committed" | "received" | "issued") => {
    for (const r of rows) {
      const e = byCc.get(r.costCodeId) ?? { costCodeId: r.costCodeId, costCode: r.costCode, committed: "0", received: "0", issued: "0" };
      e[key] = m2(dec(e[key]).plus(r.value));
      byCc.set(r.costCodeId, e);
    }
  };
  add(committedRows, "committed"); add(receivedRows, "received"); add(issuedRows, "issued");
  const ccNames = await db.execute<{ id: string; name: string }>(sql`select id, name from cost_codes`);

  const mrCounts = await db.execute<{ status: string; n: number }>(sql`
    select status, count(*)::int as n from material_requests where project_id = ${projectId} group by status`);
  const openLines = await db.execute<{ id: string; mr_id: string; number: string; line_no: number; item_code: string; description: string; base_unit: string; required_date: string }>(sql`
    select l.id, mr.id as mr_id, mr.number, l.line_no, i.code as item_code, i.description, i.base_unit, mr.required_date
    from material_request_lines l join material_requests mr on mr.id = l.material_request_id join items i on i.id = l.item_id
    where mr.project_id = ${projectId} and mr.status = 'approved' order by mr.required_date, mr.number, l.line_no`);
  const f = await lineFulfilment(db, openLines.rows.map((r) => r.id));
  const today = businessToday(generatedAt);
  const mrLines = openLines.rows
    .map((r) => {
      const x = f.get(r.id)!;
      return { ...r, requested: q4(x.requested), issued: q4(x.issued), reserved: q4(x.reserved), onOrder: q4(x.onOrder), inTransit: q4(x.inTransit), uncovered: q4(x.uncovered) };
    })
    .filter((r) => dec(r.requested).gt(r.issued))
    .map((r) => ({ ...r, overdue: r.required_date < today }));

  const openPos = await db.execute<{ id: string; number: string; status: string; supplier: string; promised_date: string | null; required_date: string | null; outstanding_lines: number }>(sql`
    select po.id, po.number, po.status, c.name as supplier, po.promised_date, po.required_date,
      (select count(*)::int from purchase_order_lines pl where pl.purchase_order_id = po.id
         and pl.qty_base - pl.qty_cancelled_base - coalesce((select sum(g.qty_accepted_base) from goods_receipt_lines g where g.po_line_id = pl.id),0) > 0) as outstanding_lines
    from purchase_orders po join companies c on c.id = po.supplier_id
    where po.project_id = ${projectId} and po.status in ('approved','partially_received') order by coalesce(po.promised_date, po.required_date) nulls last`);

  const money = (v: string | null) => (showCost ? v : null);
  return {
    project: { id: project.id, code: project.code, name: project.name, status: project.status, contractValue: money(project.contractValue) },
    generatedAt: generatedAt.toISOString(),
    asOfLabel: `As at ${today} (Dubai), live data`,
    currency: "AED",
    vatBasis: "Values exclude VAT",
    costVisible: showCost,
    summary: {
      committed: money(committed),
      receivedValue: money(received),
      openCommitment: money(m2(dec(committed).minus(received))),
      issuedCost: money(issued),
      siteStockValue,
      pendingApprovalValue: money(m2(pending.rows[0].v ?? 0)),
      pendingApprovalCount: pending.rows[0].n,
      invoiced: null, paid: null, labourCost: null, subcontractCost: null, approvedBudget: null, forecastFinalCost: null,
      notTrackedReason: NOT_TRACKED,
    },
    byCostCode: [...byCc.values()].map((e) => ({
      ...e, costCodeName: ccNames.rows.find((c) => c.id === e.costCodeId)?.name ?? "",
      committed: money(e.committed), received: money(e.received), issued: money(e.issued),
    })).sort((a, b) => a.costCode.localeCompare(b.costCode)),
    materialRequests: { byStatus: mrCounts.rows, openLines: mrLines },
    openPurchaseOrders: openPos.rows.map((p) => ({ ...p, overdue: !!p.promised_date && p.promised_date < today && p.outstanding_lines > 0 })),
    siteStock,
  };
}

export async function projectDrill(db: DbOrTx, actor: Actor, projectId: string, metric: string, costCodeId?: string) {
  requirePerm(actor, "report.view", "cost.view");
  requireProject(actor, projectId, "Project");
  if (!["committed", "received", "issued"].includes(metric)) throw rule("UNKNOWN_METRIC", "Unknown metric.");
  const rows = await drillRows(db, projectId, metric as DrillMetric, costCodeId);
  return { metric, rows, total: m2(sum(rows.map((r) => r.value))) };
}

export interface ActionItem { kind: string; title: string; detail: string; due: string | null; overdue: boolean; owner: string | null; link: string; projectCode: string | null }

/** "What needs attention today" for the signed-in user, built only from records they may see. */
export async function dashboard(db: DbOrTx, actor: Actor) {
  const today = businessToday();
  const actions: ActionItem[] = [];

  for (const a of await myPendingApprovals(db, actor)) {
    actions.push({
      kind: "approval", title: `Approve ${a.docNumber}`, detail: `${a.docType === "purchase_order" ? "Purchase order" : "Material request"} from ${a.requesterName} (step ${a.stepNo}: ${a.roleKey})`,
      due: null, overdue: false, owner: "You", projectCode: a.projectCode,
      link: a.docType === "purchase_order" ? `/purchase-orders/${a.docId}` : `/material-requests/${a.docId}`,
    });
  }

  const scope = actor.allProjects ? null : actor.projectIds;
  // `col` is always a constant column name from this file; project ids are bound parameters.
  const scopeSql = (col: string) =>
    scope ? (scope.length ? sql`${sql.raw(col)} in (${sql.join(scope.map((id) => sql`${id}::uuid`), sql`, `)})` : sql`false`) : sql`true`;

  const drafts = await db.execute<{ id: string; number: string; kind: string; status: string; project_code: string }>(sql`
    select mr.id, mr.number, 'mr' as kind, mr.status, p.code as project_code from material_requests mr join projects p on p.id = mr.project_id
      where mr.requested_by = ${actor.userId} and mr.status in ('draft','rejected')
    union all
    select po.id, po.number, 'po' as kind, po.status, p.code from purchase_orders po join projects p on p.id = po.project_id
      where po.created_by = ${actor.userId} and po.status in ('draft','rejected')`);
  for (const d of drafts.rows) {
    actions.push({
      kind: "my_draft", title: `${d.status === "rejected" ? "Rejected" : "Draft"}: ${d.number}`, detail: d.status === "rejected" ? "Revise and resubmit, or cancel" : "Not yet submitted",
      due: null, overdue: false, owner: "You", projectCode: d.project_code, link: d.kind === "po" ? `/purchase-orders/${d.id}` : `/material-requests/${d.id}`,
    });
  }

  // Submittals: overdue with the consultant, or back with EDGE to revise and resubmit.
  if (can(actor, "submittal.manage")) {
    const subs = await db.select({ s: submittals, projectCode: projects.code }).from(submittals).innerJoin(projects, eq(projects.id, submittals.projectId))
      .where(and(inArray(submittals.status, ["with_consultant", "revise_resubmit", "rejected"]), scopeSql("submittals.project_id")));
    const revs = subs.length ? await db.select().from(submittalRevisions).where(inArray(submittalRevisions.submittalId, subs.map((x) => x.s.id))) : [];
    for (const { s, projectCode } of subs) {
      const st = submittalState(s, revs.find((r) => r.submittalId === s.id && r.revNo === s.currentRevision), today);
      if (st.overdue) {
        actions.push({ kind: "submittal_overdue", title: `${s.number} overdue with the consultant (${st.daysOverdue} days)`, detail: `${s.title} · chase the consultant`,
          due: st.dueDate, overdue: true, owner: "Document controller", projectCode, link: `/submittals/${s.id}` });
      } else if (st.ballInCourt === "edge") {
        actions.push({ kind: "submittal_resubmit", title: `Resubmit ${s.number}`, detail: `${s.title} · returned ${s.status === "rejected" ? "rejected" : "for revision"}`,
          due: s.requiredBy, overdue: st.lateForSite, owner: "Document controller", projectCode, link: `/submittals/${s.id}` });
      }
    }
  }

  // RFIs: overdue with the consultant, answered and waiting for EDGE to act, waiting for review, returned.
  if (can(actor, "rfi.view")) {
    const open = await db.select({ r: rfis, projectCode: projects.code }).from(rfis).innerJoin(projects, eq(projects.id, rfis.projectId))
      .where(and(inArray(rfis.status, ["internal_review", "returned", "issued", "responded"]), scopeSql("rfis.project_id")));
    const issuer = can(actor, "rfi.issue");
    for (const { r, projectCode } of open) {
      const mine = r.assigneeId === actor.userId || r.originatorId === actor.userId;
      const st = rfiState(r, today);
      const link = `/rfis/${r.id}`;
      if (st.overdue && (issuer || mine)) {
        actions.push({ kind: "rfi_overdue", title: `${r.number} overdue with the consultant (${st.daysOverdue} days)`, detail: `${r.subject}${r.blockedActivity ? ` · blocks: ${r.blockedActivity}` : ""}`,
          due: r.responseDueDate, overdue: true, owner: "Consultant (chase)", projectCode, link });
      } else if (r.status === "responded" && (issuer || mine)) {
        actions.push({ kind: "rfi_answered", title: `${r.number} answered: act on it and close`, detail: r.subject, due: null, overdue: false, owner: "You", projectCode, link });
      } else if (r.status === "internal_review" && issuer) {
        actions.push({ kind: "rfi_review", title: `Review ${r.number} before it goes to the consultant`, detail: r.subject, due: null, overdue: false, owner: "You", projectCode, link });
      } else if (r.status === "returned" && r.originatorId === actor.userId) {
        actions.push({ kind: "rfi_returned", title: `${r.number} returned to you for changes`, detail: r.subject, due: null, overdue: false, owner: "You", projectCode, link });
      }
    }
  }

  // Daily site reports: yesterday's report missing on my projects, and reports waiting for my review.
  const reportDay = lastWorkday(today);
  if (can(actor, "sitereport.create") && !actor.allProjects && actor.projectIds.length) {
    const done = await db.select({ projectId: siteReports.projectId }).from(siteReports)
      .where(and(eq(siteReports.reportDate, reportDay), inArray(siteReports.projectId, actor.projectIds), inArray(siteReports.status, ["submitted", "reviewed"])));
    const mine = await db.select({ id: projects.id, code: projects.code }).from(projects).where(and(inArray(projects.id, actor.projectIds), eq(projects.status, "active")));
    for (const p of mine.filter((x) => !done.some((d) => d.projectId === x.id))) {
      actions.push({ kind: "site_report_missing", title: `Daily report missing for ${reportDay}`, detail: "Write and submit the site report", due: reportDay, overdue: true,
        owner: "Site team", projectCode: p.code, link: `/site-reports/new?project=${p.id}&date=${reportDay}` });
    }
  }
  if (can(actor, "sitereport.review")) {
    const waiting = await db.select({ id: siteReports.id, date: siteReports.reportDate, code: projects.code, createdBy: siteReports.createdBy }).from(siteReports)
      .innerJoin(projects, eq(projects.id, siteReports.projectId))
      .where(and(eq(siteReports.status, "submitted"), scopeSql("site_reports.project_id")));
    for (const w of waiting.filter((x) => x.createdBy !== actor.userId)) {
      actions.push({ kind: "site_report_review", title: `Review the daily report of ${w.date}`, detail: "Accept it or return it with a comment", due: null, overdue: false,
        owner: "You", projectCode: w.code, link: `/site-reports/${w.id}` });
    }
  }

  if (can(actor, "mr.allocate") || can(actor, "po.create")) {
    const lines = await db.execute<{ id: string; mr_id: string; number: string; line_no: number; item_code: string; required_date: string; project_code: string }>(sql`
      select l.id, mr.id as mr_id, mr.number, l.line_no, i.code as item_code, mr.required_date, p.code as project_code
      from material_request_lines l join material_requests mr on mr.id = l.material_request_id
      join items i on i.id = l.item_id join projects p on p.id = mr.project_id
      where mr.status = 'approved' and ${scopeSql("mr.project_id")}`);
    const f = await lineFulfilment(db, lines.rows.map((l) => l.id));
    for (const l of lines.rows) {
      const ff = f.get(l.id)!;
      if (ff.uncovered.gt(0)) {
        actions.push({
          kind: "mr_uncovered", title: `${l.number} line ${l.line_no}: ${qtyText(ff.uncovered)} ${l.item_code} not covered`, detail: "Reserve stock or raise a purchase order",
          due: l.required_date, overdue: l.required_date < today, owner: "Procurement / Stores", projectCode: l.project_code, link: `/material-requests/${l.mr_id}`,
        });
      }
    }
  }

  if (can(actor, "po.view")) {
    const pos = await db.execute<{ id: string; number: string; promised_date: string | null; required_date: string | null; supplier: string; project_code: string; creator: string }>(sql`
      select po.id, po.number, po.promised_date, po.required_date, c.name as supplier, p.code as project_code, u.full_name as creator
      from purchase_orders po join companies c on c.id = po.supplier_id join projects p on p.id = po.project_id join users u on u.id = po.created_by
      where po.status in ('approved','partially_received') and ${scopeSql("po.project_id")}`);
    for (const p of pos.rows) {
      const due = p.promised_date ?? p.required_date;
      actions.push({
        kind: "po_delivery", title: `${p.number} awaiting delivery`, detail: `${p.supplier}${p.promised_date ? "" : " — no promised date recorded"}`,
        due, overdue: !!due && due < today, owner: p.creator, projectCode: p.project_code, link: `/purchase-orders/${p.id}`,
      });
    }
  }

  if (can(actor, "stock.transfer") || can(actor, "stock.adjust")) {
    const visible = (await listLocations(db, actor)).map((l) => l.id);
    if (visible.length) {
      const trf = await db.execute<{ id: string; number: string; status: string; dispatch_date: string; to_code: string; open_disc: number }>(sql`
        select t.id, t.number, t.status, t.dispatch_date, l.code as to_code,
          (select count(*)::int from stock_transfer_lines x where x.stock_transfer_id = t.id and x.discrepancy_status = 'open') as open_disc
        from stock_transfers t join locations l on l.id = t.to_location_id
        where t.to_location_id in (${sql.join(visible.map((v) => sql`${v}::uuid`), sql`, `)})
          and (t.status = 'in_transit' or exists (select 1 from stock_transfer_lines x where x.stock_transfer_id = t.id and x.discrepancy_status = 'open'))`);
      for (const t of trf.rows) {
        if (t.status === "in_transit" && can(actor, "stock.transfer")) {
          actions.push({ kind: "transfer_in_transit", title: `${t.number} in transit to ${t.to_code}`, detail: "Confirm receipt when it arrives", due: t.dispatch_date, overdue: t.dispatch_date < today, owner: "Receiving storekeeper", projectCode: null, link: `/transfers/${t.id}` });
        }
        if (t.open_disc > 0 && can(actor, "stock.adjust")) {
          actions.push({ kind: "discrepancy", title: `${t.number}: ${t.open_disc} open discrepancy line(s)`, detail: "Investigate and resolve (found / write-off)", due: null, overdue: true, owner: "Stores manager", projectCode: null, link: `/transfers/${t.id}` });
        }
      }
    }
  }

  // Reorder alerts go to the people who can act on them (stores / procurement), not to every viewer.
  if (can(actor, "stock.view") && can(actor, "mr.allocate")) {
    for (const s of (await stockPosition(db, actor, {})).filter((x) => x.belowReorder)) {
      actions.push({ kind: "low_stock", title: `Low stock: ${s.itemCode} at ${s.locationCode}`, detail: `${qtyText(s.available)} ${s.baseUnit} available, reorder level ${qtyText(s.reorderLevel ?? 0)}`, due: null, overdue: false, owner: "Stores", projectCode: null, link: `/stock?item=${s.itemId}` });
    }
  }

  actions.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  const projectsVisible = await db.execute<{ id: string; code: string; name: string; status: string }>(sql`
    select id, code, name, status from projects where ${scopeSql("id")} order by code`);
  return { today, actions, projects: projectsVisible.rows.filter((p) => canAccessProject(actor, p.id)) };
}

# Assumptions log

Each assumption is a **proposed, reversible default** used because the answer is not yet known.
None of them is an EDGE policy. Each one names who should confirm it and how hard it is to change.

Status key: **Open** (not yet confirmed) · **Confirmed** · **Changed**.

| ID | Assumption (current default) | Why / risk if wrong | Confirm with | Reversibility | Status |
|---|---|---|---|---|---|
| A-01 | One legal entity: EDGE SCM Building Contracting. | Multi-entity needs separate numbering, TRN and accounting exports. | Director / accountant | Medium: add `legal_entity_id` to documents. | Open |
| A-02 | English first. The layout avoids hard-coded left/right assumptions so Arabic/RTL can follow. | Bilingual printed documents may be contractually required. | Director | Easy for UI, medium for documents. | Open |
| A-03 | All amounts are in AED. No foreign-currency POs yet. | Imported materials are often priced in USD or EUR. | Procurement / accountant | Medium: add currency and rate per PO. | Open |
| A-04 | **Inventory valuation = moving weighted average cost per item, company-wide.** Stored as `organization_settings.valuation_method_confirmed = false`. | The accountant may require FIFO or project-specific costing. Changing the method later must not silently rewrite history. | **Accountant** | Hard after go-live: decide before real data. | Open |
| A-05 | Negative stock is never allowed. | Some contractors allow it temporarily. We prefer forcing a receipt or opening balance first. | Stores / accountant | Easy (setting exists, enforcement is in the DB). | Open |
| A-06 | **Approval thresholds are placeholders.** MR: PM. PO ≤ AED 25,000: PM. PO from AED 25,000 to 100,000: PM then Ops Manager. PO > AED 100,000: PM, then Ops Manager, then Director. | Real delegation of authority unknown (Q4). | **Director** | Easy: rows in `approval_rules`. | Open |
| A-07 | PO thresholds are evaluated on the value **excluding VAT**. | Some companies use gross value. | Director / accountant | Easy. | Open |
| A-08 | Nobody may approve their own request. The same person may not approve two steps of the same request. | Small teams may need exceptions. | Director | Easy: per-rule flag. | Open |
| A-09 | VAT codes SR (5%), ZR, EX and OOS are **unverified placeholders**, chosen per PO line. They are not used for tax reporting. | Wrong VAT treatment on reverse-charge imports, designated zones, etc. | **Accountant**, checked against current FTA guidance | Easy (code table). | Open |
| A-10 | **Material becomes project cost when issued to the work**, not when delivered to a site store. A receipt is inventory; a PO is a commitment. | If EDGE expenses material on delivery, reports will differ from accounts. | **Accountant / QS** | Medium: a "receive and issue" shortcut can be added. | Open |
| A-11 | Every stock issue must reference an **approved material-request line**. That is the authorisation. | Emergency issues need a fast path. An emergency override with an audit reason is planned for Phase 2. | Ops Manager / stores | Medium. | Open |
| A-12 | No over-receipt against a PO (0% tolerance). | Suppliers deliver over-length cable, extra bags, etc. | Procurement | Easy: tolerance setting. | Open |
| A-13 | Rejected deliveries are held as **"rejected" stock** at the receiving location with zero value until returned to the supplier. Return-to-supplier comes in Phase 2. | Physical stock count must include them. | Stores | Easy. | Open |
| A-14 | No inspection hold on receipt yet: goods are accepted or rejected at the gate. A QA/QC quarantine step is in Phase 2. | Some materials need consultant approval before use. | QA/QC | Easy (a `quarantine` status already exists). | Open |
| A-15 | Sample CSI-style **company-wide cost-code library**. Project WBS and BOQ links come later. | EDGE likely has its own codes. | QS | Easy before go-live. | Open |
| A-16 | Document numbers look like `PO-2026-00042`, one sequence per type per calendar year (Dubai date). Numbers are never reused, even when cancelled. | Existing formats may differ (Q3). | Document controller | Easy: format function. | Open |
| A-17 | Users see only projects they are members of, unless they hold a company-wide role (director, ops manager, procurement, accountant, viewer, admin). A user holds the **same roles on all their projects**. | Some staff are PM on one project and engineer on another. | Ops Manager | Medium: per-membership roles. | Open |
| A-18 | Central warehouses are visible to anyone with `stock.view`, so site staff can see what is available. Costs stay hidden. | May be considered sensitive. | Ops Manager | Easy. | Open |
| A-19 | Password login (Argon2id), 12-hour sessions, lockout for 15 minutes after 5 failures. No MFA/SSO yet. | Privileged users should use MFA in production. | IT owner | Medium: add Microsoft Entra ID / TOTP. | Open |
| A-20 | Hosting is undecided. No data is sent to third-party services. No AI features. | — | Director / IT | — | Open |
| A-21 | Reports are **"as at now"**. Historical as-at-date reporting comes later. | Month-end reporting needs period cut-offs. | QS / accountant | Medium. | Open |
| A-22 | Site engineers as well as storekeepers can post goods receipts. | Some firms restrict receiving to stores. | Ops Manager | Easy (role permission). | Open |
| A-23 | Procurement officers can create suppliers and items. | Master data is often controlled by one person. | Ops Manager | Easy. | Open |
| A-24 | A unit cost converted to the item's base unit is stored to 4 decimals. Rounding differences under AED 0.01 per line are possible on converted units. | Exact reconciliation with invoices may need line-level adjustment. | Accountant | Easy. | Open |
| A-25 | No work calendars or holidays are used yet. Only the daily-report working week (A-30) is assumed. | Holidays will show as "missing report". | Planning | Medium. | Open |
| A-27 | Each project has its **own consultant review codes** (e.g. A/B/C/D or 1/2/3/4), each mapped to a meaning: approved, approved with comments, revise and resubmit, rejected, for information. Demo projects use A–D and 1–4. A code already used on a response cannot be removed or change meaning. | EDGE said codes vary by consultant. | Document controller | Easy (per-project table). | Open |
| A-28 | The consultant's reply is due **14 calendar days** after submission unless the project says otherwise. | The contract usually states the review period (often working days). | PM / contracts | Easy (per-project setting). | Open |
| A-29 | A purchase order cannot be **submitted for approval** while an item on it is linked to a submittal on that project that is not yet approved. Drafts are allowed. Items with no linked submittal are not blocked. | Some urgent orders may need a documented override. | Ops Manager | Easy: add an override with reason. | Open |
| A-30 | A daily site report is expected for every active project on **Monday to Saturday**. The "missing report" reminder and the overview use this. | EDGE's actual working week and holidays may differ by site. | Ops Manager | Easy (one constant now; project calendars later). | Open |
| A-31 | A daily report can be written **up to 7 days late**, never for a future date. One report per site per day. | Some teams batch reports weekly. | Ops Manager | Easy. | Open |
| A-32 | The person who wrote a daily report cannot review it. Project managers and operations managers review. | Very small sites may have one person. | Ops Manager | Easy. | Open |
| A-33 | **Overview ratings** (proposed): programme amber when actual is 3 or more points behind plan, red at 10 or more points behind or a forecast finish after the planned date; approvals red when a submittal is more than 7 days overdue with the consultant or not approved by the date site needs it; site red after 3 working days without a report; safety red after any incident in 30 days; materials red when a delivery is more than 7 days late. | The owner may want different tolerances. | **Director** | Easy (one table of thresholds). | Open |
| A-34 | Progress % (planned and actual) is **entered weekly by the PM**, not calculated from a schedule. A schedule with activities and weights comes with the planning module. | Manual % can be optimistic. | Director / planning | Medium. | Open |
| A-35 | A **Document Controller** role exists (project-scoped) to keep the submittal register. Project managers can also manage submittals. | EDGE may not have this role on every project. | Ops Manager | Easy. | Open |
| A-26 | Demo data is **synthetic**, shares one documented password, and can only be loaded when `ALLOW_DEMO_SEED=true` outside production. | Must never reach production. | IT owner | — | Confirmed (design) |

## Compliance-sensitive rules deliberately **not** automated

- VAT/tax reporting, e-invoicing, WPS, payroll, leave and end-of-service calculations, and any
  authority submission. These need current official guidance (FTA, MoF, MOHRE). Record the source
  URLs and verification dates, and have EDGE's accountant or HR owner sign off before any automation.
  See `docs/REQUIREMENTS.md` §Compliance boundaries.

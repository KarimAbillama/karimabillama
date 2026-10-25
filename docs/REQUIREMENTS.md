# Requirements

Source: the product brief in `docs/PRODUCT_BRIEF.md` (referenced as §1–§19). The brief is a
**proposal**, not a statement of EDGE's existing policies.

Each requirement has one of three statuses:

- **Confirmed**: stated by EDGE. *Currently none; discovery is open (see `docs/DISCOVERY.md`).*
- **Proposed default**: our reversible assumption (IDs refer to `docs/ASSUMPTIONS.md`).
- **Later option**: deliberately deferred (see `docs/ROADMAP.md`).

Status of each requirement in the build: ✅ built and tested · 🟡 partly built · ⬜ not started.

## 1. Guiding principles (§1)

| ID | Requirement | Status |
|---|---|---|
| P-1 | Enter data once and reuse it via links. A project, supplier, item or cost code is one record shared by all modules. | ✅ for Phase 1 entities (FK-linked) |
| P-2 | Show what needs attention today, who owns it, when it is due, and its effect. | 🟡 Action dashboard shows owner and due date. Schedule and cost impact need the planning module. |
| P-3 | Functioning workflows, not mock-ups. No hard-coded charts. | ✅ |

## 2. Access and approvals (§3)

| ID | Requirement | Status |
|---|---|---|
| R-ACC-1 | Configurable roles (15 suggested). 11 are seeded; the others are planned with their modules. | 🟡 |
| R-ACC-2 | Permissions are enforced on the server, including direct URLs, lists, reports and exports. | ✅ scenario 5 tests |
| R-ACC-3 | Users are scoped to assigned projects; locations follow project scope. | ✅ (A-17, A-18) |
| R-ACC-4 | View, create, approve, export and administer permissions are separated. Post and reverse are separate per stock action. | ✅ |
| R-ACC-5 | Supplier rates and costs are restricted, and redacted in API responses. | ✅ Salaries, IDs and bank details come with HR (Phase 2+). |
| R-ACC-6 | External roles stay disabled until configured. | ✅ none exist |
| R-APR-1 | Approval rules by document type, value band, project and sequential steps. | ✅ (A-06, A-07) |
| R-APR-2 | Rejection requires a reason. Approver, timestamp, revision and decision are recorded. | ✅ |
| R-APR-3 | A change after approval forces reapproval (revision supersedes the old approval). | ✅ for MR and PO before receipt |
| R-APR-4 | No self-approval. Segregation between steps. | ✅ (A-08) |
| R-APR-5 | Delegation with expiry, overdue escalation, notifications. | ⬜ Phase 2 |
| R-APR-6 | Emergency override with an authorised user and an audit reason. | ⬜ Phase 2 (A-11) |
| R-APR-7 | Internal approval kept separate from a consultant's external response. | ⬜ with RFIs/submittals |

## 3. Inventory (§6)

| ID | Requirement | Status |
|---|---|---|
| R-INV-1 | Item master with base and purchase units and tested conversions. Invalid cross-dimension conversions are refused. | ✅ unit tests |
| R-INV-2 | Physical stock kept separate from reserved, available (free), quarantined, rejected, in-transit and discrepancy stock. | ✅ |
| R-INV-3 | Central warehouse, site stores and a transit location. Bins come later. | 🟡 |
| R-INV-4 | Append-only movement ledger. No edits or deletes (DB trigger). Corrections are new rows. | ✅ |
| R-INV-5 | Negative stock prevented (DB constraint). | ✅ (A-05) |
| R-INV-6 | Transfers need dispatch and receipt. In transit until received. Partial receipt creates a discrepancy, resolved as found or written off. | ✅ scenario 2 |
| R-INV-7 | Transactions and locking prevent double issue. Idempotent retries. | ✅ scenario 3 |
| R-INV-8 | Consumption linked to project, site, MR line, cost code, recipient and date. Delivery to site is not consumption. | ✅ (A-10) |
| R-INV-9 | Stock card. Low-stock alerts. | ✅ |
| R-INV-10 | Stock ageing, cycle counts, variance approval, QR labels, batch/serial/expiry. | ⬜ Phase 2 |
| R-INV-11 | Valuation method agreed with the accountant and never silently switched. | 🟡 WAC proposed and flagged unconfirmed (A-04) |
| R-INV-12 | Tools and equipment register. | ⬜ Phase 2 |

## 4. Procurement (§7)

| ID | Requirement | Status |
|---|---|---|
| R-PRC-1 | Site MR → approval → availability/reservation → shortage → PO → delivery → receipt. | ✅ (requisition and RFQ steps come in Phase 2) |
| R-PRC-2 | Line-level links (MR line ↔ PO line ↔ receipt line ↔ issue line). | ✅ |
| R-PRC-3 | Partial deliveries, rejected quantities with reasons, cancelled balances (short-close). | ✅ |
| R-PRC-4 | No over-ordering beyond the request shortage. No over-receipt. | ✅ (A-12) |
| R-PRC-5 | Required date, promised date and late flag. | ✅. Lead time and latest order date need the schedule (Phase 2). |
| R-PRC-6 | RFQs, quotation comparison (not cheapest-wins), split suppliers, substitutions. | ⬜ Phase 2 |
| R-PRC-7 | Blocked by an unapproved submittal or drawing. | ⬜ Phase 2 |
| R-PRC-8 | Three-way match, duplicate invoice detection, credit notes, payment status. | ⬜ Phase 2 (scenario 4) |
| R-PRC-9 | Service procurement certified without fake stock receipts. | ⬜ Phase 2 |
| R-PRC-10 | No bank payments initiated by the system. | ✅ (none exist) |

## 5. Reporting (§5, §10)

| ID | Requirement | Status |
|---|---|---|
| R-REP-1 | Project overview figures drill down to their source records. Totals reconcile. | ✅ scenario 10 |
| R-REP-2 | Every KPI has a definition and an as-at label. Missing data is shown as missing, never zero. | ✅ "Not tracked yet" |
| R-REP-3 | CSV exports protected against formula injection, and audited. | ✅ |
| R-REP-4 | Branded PDFs, weekly and monthly reports. | ⬜ |

## 6. Engineering quality (§15, §16)

| ID | Requirement | Status |
|---|---|---|
| R-ENG-1 | Modular monolith, PostgreSQL, migrations, fixed-precision decimals. | ✅ |
| R-ENG-2 | Optimistic concurrency on edits. Concurrency-safe numbering. | ✅ |
| R-ENG-3 | Idempotency keys for postings. | ✅ |
| R-ENG-4 | Session security, rate-limited login, lockout, CSRF guard, httpOnly cookies, no secrets in logs. | ✅ |
| R-ENG-5 | Backups with a tested restore procedure. | ✅ manual run (scenario 11). File storage pending. |
| R-ENG-6 | Mobile-first workflows (receipt, issue, request). | 🟡 Responsive. Tested on a 390 px phone viewport for receipts. |
| R-ENG-7 | Offline drafts. | ⬜ Phase 4 (scenario 12) |
| R-ENG-8 | Excel/CSV import with preview and validation. | ⬜ Next |
| R-ENG-9 | Private file storage with signed downloads, type/size validation, scanning. | ⬜ Next (needs hosting decision) |

## Compliance boundaries (§14)

These are **not implemented** and must not be implied:

- No VAT return, e-invoicing integration, WPS file, payroll or end-of-service calculation, or
  authority portal integration.
- VAT codes on POs are placeholders for commercial visibility only (A-09).
- Before any regulated calculation is built, record the official source (FTA, MoF, MOHRE), its URL and
  verification date in this file, and get sign-off from EDGE's accountant or HR owner.
- Retention periods, legal holds and data residency are open questions (Q9).

## Acceptance scenarios (§18) — status

| # | Scenario | Status | Evidence |
|---|---|---|---|
| 1 | 100 requested, 40 reserved, PO 60, 50 delivered with 5 rejected, issue only authorised stock | ✅ | `tests/scenario1-procurement.test.ts`, e2e |
| 2 | Transfer 20, 18 received, 2 to discrepancy, global stock reconciles | ✅ | `tests/scenario2-transfer.test.ts` |
| 3 | Concurrent issue of the last 10. A retry does not duplicate. | ✅ | `tests/scenario3-concurrency.test.ts` |
| 4 | Invoice mismatch and duplicate reference | ⬜ | Phase 2 |
| 5 | Project isolation, restricted fields | ✅ (salaries pending HR) | `tests/scenario5-permissions.test.ts`, e2e |
| 6 | Attendance overlap and corrections | ⬜ | Phase 1 next slice |
| 7 | Overdue RFI with linked blocked activity | ⬜ | Phase 1/2 |
| 8 | Pending variation excluded. A revised document invalidates the old approval. | 🟡 revision part | `tests/approvals.test.ts` |
| 9 | Drawing revisions | ⬜ | Phase 2 |
| 10 | Dashboard totals reconcile with ledger, reports and exports | ✅ | `tests/units-and-reconciliation.test.ts` |
| 11 | Backup restored into a clean environment | ✅ (manual) | `scripts/restore.sh` + `scripts/verify-restore.sql` |
| 12 | Offline draft sync | ⬜ | Phase 4 |

# Roadmap and backlog

Order will be adjusted after discovery answers (`docs/DISCOVERY.md`). We build one tested vertical
slice at a time. Menu items only appear for modules that work.

## Phase 0 — Discovery and foundation ✅ (pending EDGE answers)

- [x] Repository, local dev environment (Docker Postgres), migrations, seed, CI-ready test commands
- [x] Requirements, assumptions, architecture choice, data model, permissions, roadmap
- [ ] EDGE answers the 10 discovery questions; assumptions confirmed or changed
- [ ] Real forms/registers reviewed; numbering formats and cost codes agreed
- [ ] Hosting decision and budget (Q9)

## Phase 1 — Operational MVP

**Slice 1: procurement to stock to report** ✅ built and tested

login → authorised project → material request → approval → PO → partial receipt → stock issue →
project report, plus transfers, reservations, stock card, action dashboard, CSV exports and audit trail.

Next slices, in proposed order:

1. **Admin screens.** Create and deactivate users, assign roles and projects, edit approval rules and
   masters (items, suppliers, locations, cost codes) in the UI. Add a CSV import with preview,
   validation, duplicate detection and owner sign-off for opening stock and masters.
2. **Daily site report.** Draft → submitted → approved/returned. Manpower, equipment, work done by
   area, deliveries prefilled from receipts, photos (needs private file storage), PDF export.
3. **Basic attendance.** Foreman crew entry on mobile, no overlapping timesheets, approval lock,
   controlled corrections (scenario 6). No payroll calculation.
4. **RFI register.** States, consultant response recorded separately from internal closure, overdue
   ageing, linked drawing/activity (scenario 7, partially).
5. **Stock completeness.** Return to supplier for rejected goods, issue returns, stock counts with
   variance approval, emergency issue override with audit reason, PO amendments after receipt.
6. **Production hardening.** MFA or Microsoft 365 SSO for privileged users, security headers/CSP,
   staging environment, automated backups and restore drill, monitoring. Then UAT with EDGE staff.

## Phase 2 — Execution control

- Supplier RFQs, quotation comparison (compliance, landed cost, lead time, past performance), award approval
- Supplier invoices: line-level three-way match with tolerances, exception queue, duplicate invoice
  reference detection, credit notes, payment status export (scenario 4)
- Document control: drawing register with revisions/supersession (scenario 9), submittals with
  configurable consultant codes, transmittals, correspondence
- Procurement blocked by unapproved submittals; required-on-site / latest-order-date from schedule
- QA/QC (ITPs, inspection requests, NCRs, quarantine release), HSE (incidents restricted, permits, toolbox talks)
- Schedule: WBS, activities, dependencies (clearly stated subset), baselines, 2- and 6-week look-aheads,
  constraints register, CSV/Excel interchange (no native P6/MSP claims without verified support)
- Equipment and tools register; manpower planning; approval delegation and escalation; notifications

## Phase 3 — CRM and commercial

- Companies/contacts CRM, opportunities, bid/no-bid, versioned estimates and BOQs (markup vs margin)
- Award → project with preserved quotation, BOQ and budget
- Budgets by cost code, variations (pending excluded from approved revenue, scenario 8), subcontract
  packages and certification, client applications and certificates, retention, cash forecast
- Accounting and payroll exports with reconciliation reports

## Phase 4 — Integrations and extensions

- Agreed integrations (accounting, email, document storage), validated payroll/accounting extensions
- External portals (client, consultant, subcontractor, supplier)
- Offline drafts with visible sync status and conflict resolution (scenario 12)
- Optional AI assistance (draft or summarise only, human-verified, approved configuration)

## Known limitations of the current build

- Reports are "as at now" only. There are no historical cut-offs yet.
- Admin changes (users, roles, rules) are made through seed/import scripts, not UI screens.
- No file attachments yet. Delivery note photos come with the file storage slice.
- Transfers of *reserved* stock are supported by the API (`mrLineId`). The transfer screen only
  moves free stock.
- One role set per user across all their projects (A-17).
- English only. The layout is RTL-ready but not translated.
- Not production-ready: user acceptance testing, MFA and the hosting decision are outstanding.

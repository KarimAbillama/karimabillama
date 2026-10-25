# EDGE SCM — Construction CRM & ERP: Product brief

> Copied from the master prompt supplied by EDGE (October 2026). This is a **proposed product brief**,
> not a statement of EDGE's existing internal policies. Section numbers (§) are referenced from the
> other documents in `docs/`.

You are my senior construction software product architect and full-stack engineer. Help me design and build a connected CRM and ERP for EDGE SCM Building Contracting in Dubai, UAE.

I understand construction operations but I am not a software developer. Explain important decisions in plain English, recommend sensible defaults, and build functioning software incrementally. Do not deliver only a dashboard mockup, disconnected CRUD screens, or hard-coded charts.

## 1. Company context and objective

EDGE manages construction projects from mobilisation through procurement, execution, inspection, commercial closeout, and handover. Support general building, fit-out, landscape, hardscape, irrigation, swimming pools, and MEP packages as configurable disciplines; confirm our actual scope rather than assuming every discipline applies.

I need visibility across inventory, sites, reports, staff, labour, schedules, timelines, RFIs, procurement, costs, and management actions. The platform must show what needs attention today, who owns it, when it is due, and its effect on delivery and cost.

The central principle: enter information once, then reuse it across linked workflows. A project, supplier, employee, material, drawing, or BOQ item must not be recreated independently in each module.

## 2. Discovery before implementation

Inspect the existing repository and its instructions first. Preserve existing work. If this is a new repository, establish a clean development environment.

Ask a maximum of 10 high-impact questions in your first response, grouped and written for a nontechnical construction manager. Cover:

- Number of active sites, offices, warehouses, staff, workers, and intended system users.
- Which three operational problems must be solved first.
- Current Excel registers, forms, document numbering, and approval procedures.
- Existing accounting, payroll, scheduling, email, and document storage systems.
- Whether payroll/accounting should remain in existing software or eventually move into this platform.
- Internal users versus client, consultant, supplier, and subcontractor access.
- Purchasing approval limits, emergency purchases, and who can approve their own requests.
- Site connectivity, shared devices, mobile usage, and language needs.
- Hosting, budget, data location, security, and deployment ownership.
- A real example of a project workflow and representative redacted forms.

If I cannot answer, record a clearly labelled assumption and propose a reversible default. Do not invent company rules or turn uncertain legal requirements into software logic. Continue with useful planning and a local development prototype while awaiting nonblocking answers.

Create a requirements document, assumptions log, role/permission matrix, entity relationship diagram, phased backlog, and acceptance criteria. Separate confirmed requirements, proposed defaults, and later options.

## 3. Roles, access, and approvals

Suggested configurable roles: administrator, owner/director, operations manager, project manager, site engineer, foreman, planning engineer, quantity surveyor, procurement officer, storekeeper, accountant, HR/payroll officer, QA/QC engineer, HSE officer, document controller, and read-only management user.

Future external roles: client, consultant, subcontractor, and supplier. Keep external access disabled until explicitly configured.

Enforce permissions on the server and file downloads, not only by hiding buttons. Scope users to assigned projects and locations. Separate view, create, edit, submit, approve, reject, post, reverse, export, and administer permissions. Restrict salaries, identity documents, bank details, supplier rates, and margins appropriately.

Approval rules must support document type, value threshold, project, cost category, sequential approvers, delegation with expiry, rejection reasons, and overdue escalation. Distinguish internal approval from a consultant's external response. Record the approver, timestamp, document revision, and approval decision. A material change after approval must trigger reapproval. Prevent self-approval where configured. Emergency overrides require authorised users and an audit reason.

## 4. CRM, tenders, and estimating

Maintain companies and contacts with multiple roles: client, consultant, supplier, subcontractor, developer, and authority. Track contacts, communication notes, follow-ups, attachments, and responsible employees.

Track opportunities from enquiry through qualification, site visit, tender, quotation, negotiation, award, loss, or cancellation. Include scope, location, estimated value, submission deadlines, bid/no-bid decision, probability, source, next action, and loss reason.

Provide versioned estimates and BOQs with quantities, units, materials, labour, equipment, subcontract costs, overheads, contingency, markup, and tax treatment. Distinguish markup from margin. Support exclusions, clarifications, alternate offers, quotation expiry, bid bonds, and tender documents.

An awarded opportunity should create a project while preserving the accepted quotation, original BOQ, client information, and initial budget. Revisions must not silently overwrite the awarded basis.

## 5. Project and site workspace

Each project needs a unique code, client, consultants, contract reference, location, plot details, authority jurisdiction, project team, dates, scope, contract value, budget, retention rules, payment terms, warranty/defects period, and attachments.

Support one project with multiple sites, zones, buildings, floors, work packages, and storage locations. Use a consistent work breakdown structure and cost codes shared by procurement, inventory, labour, planning, and cost reporting.

Provide a project overview with schedule status, progress, approved budget, committed cost, incurred cost, cash paid, forecast final cost, overdue actions, procurement constraints, RFIs, inspections, and daily reports. Every figure must drill down to its source records.

## 6. Inventory, warehouses, tools, and equipment

Material master: item code, description, category, specifications, brand, approved alternatives, base unit, purchasing unit, tested unit conversion, minimum stock, reorder level, supplier links, storage rules, and optional batch/serial/expiry information. Support units such as pieces, bags, boxes, pallets, metres, square metres, cubic metres, kilograms, tonnes, and litres without allowing invalid conversions between dimensions.

Separate physical stock, reserved stock, available stock, quarantined stock, rejected stock, and goods in transit. Model central warehouse, site stores, bins, and authorised direct-to-site deliveries.

Maintain an immutable stock movement ledger for opening balances, receipts, issues, returns, transfers, adjustments, damages, wastage, and stock counts. Posted mistakes must be reversed or adjusted, never silently edited. Default to preventing negative stock; any exception needs explicit policy and traceability.

Transfers require dispatch and destination receipt. Dispatch puts quantities in transit; destination availability changes only on receipt. Support partial receipt, discrepancies, unit conversion, damaged goods, and return to supplier. Use transactions and concurrency controls to prevent overselling or issuing the same stock twice.

Link material consumption to project, zone, BOQ/WBS activity, cost code, recipient, and date. Distinguish delivery to a site store from actual consumption; moving material must not automatically count it as installed progress.

Provide stock cards, stock ageing, low-stock alerts, cycle counts, variance approvals, QR/barcode labels, and item/location history. Define an inventory valuation method with the accountant; do not silently switch methods.

Track reusable tools separately: serial number, custodian, issue/return, condition, damage, and loss. Track equipment ownership/rental, availability, site allocation, inspection, maintenance, fuel, utilisation, operator, rental dates, and cost allocation.

## 7. Procurement and supplier management

Implement the connected flow:

Site material request → internal approval → stock availability/reservation check → purchase requisition for shortage → supplier RFQs → quotation comparison → award approval → purchase order → delivery tracking → goods receipt/inspection → supplier invoice matching → payment status.

Support line-level quantities and links throughout, partial deliveries, split suppliers, backorders, substitutions requiring approval, cancelled balances, damaged/rejected receipts, delivery notes, transport costs, discounts, VAT treatment, and payment terms.

Compare supplier offers on specification compliance, total landed cost, delivery lead time, availability, warranty, payment terms, and past performance. Do not automatically award to the cheapest supplier.

Keep commercial purchasing approval separate from consultant material approval. Show when a purchase is blocked by an unapproved material submittal or drawing.

Track required-on-site date, procurement lead time, latest order date, promised date, actual receipt date, and affected schedule activity. Flag late items and long-lead procurement.

Perform line-level three-way matching of PO, accepted goods receipt, and supplier invoice with configurable quantity/price tolerances and an exception approval queue. Detect duplicate invoice references per supplier/legal entity. Handle supplier credit notes and returns.

Record payment information and export to accounting initially; do not initiate bank payments. Support service procurement using approved service/work certification instead of fictitious stock receipts.

## 8. Staff, labour, attendance, and productivity

Separate employee records from login accounts; most workers may not need individual system access. Track employees, company labour, subcontractor labour, trades, supervisors, employment status, site assignment, emergency contacts, approved rates, and relevant document expiries with restricted access.

Allow foremen to enter crew attendance efficiently on mobile. Track date, shift, site, activity/cost code, normal hours, overtime, absence, leave, and transfers between sites. Prevent overlapping timesheets and duplicate hours. Require approval before hours feed labour costs or payroll exports. Lock approved periods and use controlled corrections.

Compare planned and actual manpower and measurable productivity, such as installed square metres per approved labour-hour. Do not mix incompatible units or claim productivity where installed quantities are absent.

Include overtime requests, leave workflow, onboarding/offboarding, training, competency certificates, and expiry alerts. Keep work calendars, overtime categories, holidays, and heat-related restrictions configurable and effective-dated.

Phase one should provide approved attendance and payroll inputs. Full salary calculation, leave accrual, end-of-service benefits, and WPS-compatible export require a separately validated HR/payroll specification and test cases. Do not claim payroll compliance from attendance tracking alone. Do not introduce biometric tracking or continuous location surveillance by default.

## 9. Schedule, timeline, and progress

Provide WBS, activities, milestones, owners, planned and actual dates, durations, calendars, dependencies, baselines, progress updates, and a Gantt timeline. For the first version implement a clearly stated dependency subset correctly, then expand if required.

Keep original baseline, approved revised baselines, and current forecast distinct. Support two-week and six-week look-ahead views and a constraints register for materials, drawings, access, permits, labour, equipment, and inspections.

Define progress measurement per activity: accepted installed quantity, weighted milestone, or authorised manual update with evidence. Aggregate using documented weights; do not average percentages arbitrarily. Do not confuse procurement progress, physical completion, and financial certification.

Show delayed and blocked activities with reasons and owners. Calculate critical path/float only if a real scheduling engine and calendar/dependency logic are implemented and tested. Otherwise label those features unavailable. Offer staged CSV/Excel interchange with existing planning tools; do not promise native Primavera or Microsoft Project integration without verified support.

## 10. Daily site reports and management reporting

Mobile daily reports should capture project, date, weather entered or sourced with attribution, responsible engineer, work completed by area/activity, measured quantities, manpower by trade, equipment, deliveries, inspections, incidents, delays, instructions, visitors, and captioned photos.

Prefill from attendance, delivery, and activity records while requiring the engineer to validate the report. Use draft → submitted → approved/returned states. Approved reports retain revision history. Export branded PDFs and spreadsheets.

Create weekly progress reports, monthly project status reports, meeting minutes, action registers, procurement reports, inventory reports, manpower summaries, RFI/submittal ageing, cost variance, receivables/payables summaries, and HSE/quality summaries. Give every KPI an explicit definition and as-of date. Show missing data as missing, not zero.

## 11. RFIs, submittals, drawings, and correspondence

RFI fields: project number, discipline, subject, question, location, related drawing and revision, BOQ/activity references, attachments, originator, assignee, external recipient, issue date, response due date, priority, response, closure date, and possible cost/schedule impact.

Support draft, internal review, issued, responded, returned, closed, and cancelled states with a controlled transition history. Allow manual recording of consultant responses and attachments before email integrations exist. A response must not automatically authorise a commercial variation.

Manage material submittals, shop drawings, method statements, samples, mockups, transmittals, consultant comments, and resubmissions. Make response codes configurable per consultant/project; distinguish approved, approved with comments, revise/resubmit, and rejected.

Drawing register: document number, title, discipline, revision, issue date, status, purpose, approval, superseded revision, and distribution history. Always highlight the current approved construction revision. Preserve old revisions and warn users when linking superseded drawings.

Maintain correspondence, site instructions, meeting minutes, action owners, contractual notice dates, and searchable attachments. Use configurable document numbering with concurrency-safe unique sequences and no number reuse after cancellation.

## 12. QA/QC, HSE, permits, and handover

Quality: inspection and test plans, material inspection requests, work inspection requests, hold/witness points, checklists, test results, nonconformance reports, corrective actions, reinspection, closure evidence, and snag lists. Tie inspections to locations, drawings, materials, and activities.

HSE: inductions, toolbox talks, training, risk assessments, permits to work, observations, incidents/near misses, corrective actions, PPE issue records, and equipment certification. Sensitive incident data needs restricted access. Software records must not imply safety certification.

Authority/permit register: authority, permit/NOC type, reference, required documents, owner, submission date, status, conditions, expiry, and evidence. Make jurisdiction configurable because Dubai Municipality, development authorities, utilities, Civil Defence, and master developers may differ by project. Do not assume every listed authority applies to every site or claim direct portal integration.

Handover: snag closure, as-built drawings, O&M manuals, warranties, asset lists, training records, completion certificates, client acceptance, defects period, and retention release milestones.

## 13. Commercial control, variations, subcontractors, and finance

Maintain original contract value, approved variations, revised contract value, pending/unapproved variations, and original/revised cost budgets separately. Track instructions, quotations, supporting evidence, notice deadlines, approval, and impact. Never include an unapproved variation in approved revenue by default.

Support subcontract packages, scope, rates/BOQ, commitments, mobilisation advances, securities, insurance expiry, measured work, progress applications, certified values, retention, advance recovery, contra charges, backcharges, and final accounts. Keep applied, certified, invoiced, and paid amounts distinct.

Client commercial records: progress applications, certificates, invoices, credit notes, receipts, retention receivable, advances, deductions, disputed values, and payment due dates.

Project cost reporting must distinguish budget, approved commitments, unconsumed commitment balance, accrued/actual cost, cash paid, forecast remaining cost, estimate at completion, and variance. Define exactly when each cost is recognised. Avoid counting a PO, receipt, invoice, and payment as four expenses for the same purchase. Explain inventory holding cost versus project consumption and avoid counting transferred material twice.

Begin with operational cost control and reconciliation-friendly exports to the existing accounting system. If a full accounting module is later authorised, scope double-entry ledgers, chart of accounts, AP/AR, tax codes, credit notes, bank reconciliation, period locks, reversal entries, and accountant-reviewed financial statements as a separate phase.

No bank payment execution, automatic tax filing, or autonomous commercial commitments in the initial system.

## 14. Dubai/UAE configuration and compliance boundaries

Default to AED and Asia/Dubai display time, store timestamps consistently, and distinguish local date-only fields from timestamps. Make financial year, calendars, weekends, holidays, and company policies configurable. Use English first with architecture supporting Arabic/RTL; confirm whether bilingual documents are required.

Include company/client/supplier legal names, addresses, TRNs where applicable, currency/exchange-rate fields, tax codes, invoice/credit-note references, and supporting records. Do not apply one tax treatment blindly to every transaction.

Before implementing regulated financial or employment calculations, check current official FTA, Ministry of Finance, MOHRE, and relevant authority guidance, record source URLs and verification dates, and have the designated accountant/HR owner validate the configuration. If unavailable, label rules unverified and keep compliance-critical automation disabled.

Track WPS preparation separately from actual bank/provider submission and acknowledgement. Treat e-invoicing as a separately scoped integration with current applicability, deadlines, approved provider requirements, structured formats, validation, and acknowledgement handling. A PDF invoice alone must not be labelled an e-invoicing integration.

Configure document retention by record category and applicable rules, with legal holds where required. Assess personal-data access, hosting region, backups, subprocessors, and cross-border transfers with the company. Do not assume UAE-only hosting is automatically required or that any cloud deployment is automatically compliant.

## 15. Architecture and engineering quality

Choose a maintainable modular monolith for the first version. Before committing, briefly compare a custom application with extending a suitable established ERP, based on licensing, workflows, accounting integration, maintenance, and our budget. Recommend one path; do not spend weeks evaluating alternatives.

For a new custom build, a reasonable proposed stack is TypeScript, a maintained React-based web framework, PostgreSQL, a migration-capable ORM, established authentication, private object storage, and background jobs for exports/notifications. These are proposals: verify current official documentation and compatible supported versions, inspect the existing stack, then explain the final choice. Avoid unnecessary microservices and custom authentication cryptography.

Use real persistence, server-side validation, database constraints, transaction-safe posting, fixed-precision money/quantity calculations, pagination, indexed search, and documented API boundaries. Prevent race conditions in stock, approvals, numbering, and payments. Use idempotency keys for retries/imports and controlled concurrency on edits.

Core entity relationships should include company, user, role, membership, contact, opportunity, estimate, project, site, location, WBS, cost code, BOQ, budget, supplier, item, stock movement, reservation, material request, RFQ, quotation, PO, receipt, invoice, employee, attendance, activity, baseline, progress update, RFI, submittal, document revision, inspection, variation, subcontract, certificate, approval, action, notification, and audit event. Implement only phase-relevant entities, with explicit links and foreign keys.

Provide authentication, session security, optional MFA for privileged users, least privilege, secure secrets, HTTPS deployment guidance, rate limits, safe file upload limits/type validation, private signed downloads, attachment scanning strategy, and audit history. Audit exports and sensitive access where appropriate. Do not put identity documents, salaries, tokens, or bank details in ordinary logs.

Use private development/staging/production separation, migration rollback/recovery planning, automated backups, and a tested restore procedure. Agree recovery targets before production. Do not call it production-ready until access isolation, backup restoration, and user acceptance tests pass.

If AI features are added later, use them for reviewable summaries or draft extraction. Require human verification of extracted amounts/quantities and references. Do not send confidential project or employee data to external AI services without an approved configuration. AI must never approve purchases, payroll, safety records, or variations autonomously.

## 16. Interface and site usability

Build a clean, professional interface with a global project selector, role-specific home screen, quick actions, saved filters, searchable registers, clear statuses, attachments, activity history, and drill-down details. Use realistic construction terminology and show useful empty states.

Prioritise mobile workflows: crew attendance, material request, goods receipt, stock issue, daily report, photos, and inspection checklist. Minimise typing and support batch entry. Test on tablet and phone as well as desktop.

Stage offline drafts if needed. Show unsynced status, retain drafts through connection loss, and resolve conflicts visibly. Never post duplicate stock transactions after retry. Approvals, final stock posting, and other sensitive actions require online validation. Avoid caching sensitive HR data on shared devices.

Provide Excel/CSV import templates, mapping, preview, validation errors, duplicate detection, import audit, and safe retry. Support opening stock, supplier/item masters, employees, BOQs, and opening project balances with owner sign-off. Protect exports against spreadsheet formula injection. Demo data must be visibly synthetic and separate from production.

## 17. Delivery phases

**Phase 0** — discovery, process maps, architecture choice, database design, permissions, import strategy, acceptance criteria, and runnable local foundation.

**Phase 1** — operational MVP: login and project permissions; project/site/cost-code masters; suppliers/items; material requests; simple approvals; purchase orders; partial goods receipts; stock ledger, issues and transfers; basic attendance; daily reports; RFI register; action dashboard; exports and audit trail. Keep workflow depth reliable and UI simple.

**Phase 2** — execution control: supplier RFQs/comparisons and invoice matching; document/submittal control; QA/QC; HSE; schedules/look-aheads; procurement constraints; manpower planning; equipment/tools; richer dashboards.

**Phase 3** — CRM/commercial: opportunity/estimating workflows; BOQ budgets; variations; subcontractor certification; client payment applications; cash forecasting; accounting/payroll exports and reconciliation.

**Phase 4** — agreed integrations, validated payroll/accounting extensions, external portals, advanced analytics, selected offline features, and optional AI assistance.

After confirming priorities, adjust the order. Build one tested vertical slice at a time. Do not add dozens of nonfunctional navigation items or claim future modules are complete.

## 18. Required acceptance scenarios

Use automated tests for critical calculations, permissions, and posting workflows, plus end-to-end tests for real user journeys. Include:

1. A site engineer requests 100 units of material. Forty available warehouse units are reserved and a PO is raised for 60. A delivery of 50 has five rejected units: 45 become available, five remain quarantined/rejected, and 15 accepted units remain outstanding against the PO. Issue only available authorised quantities; preserve all request/PO/receipt/cost links.
2. A dispatch of 20 units from Warehouse A appears in transit. Site B receives 18; the missing two enter a discrepancy workflow. Global stock and custody reconcile without invented receipt or duplicate expense.
3. Two users attempt to issue the last 10 units simultaneously. Only a valid total quantity can post. A network retry cannot create a second issue.
4. A supplier invoice with a quantity/rate discrepancy is held for exception review. A repeated invoice reference is flagged. Payment does not create a duplicate project cost.
5. A foreman cannot see salaries; a user assigned only to Project A cannot read or export Project B records, including through direct URLs, APIs, search, or file downloads.
6. Approved attendance cannot overlap across sites or be silently edited. Corrections retain the original record and approvals.
7. An overdue RFI is visible with its owner and linked blocked activity. A consultant response and internal closure remain distinct.
8. A pending variation remains excluded from approved contract revenue until authorised. A revised document invalidates the old approval where required.
9. A drawing revision preserves the prior file and clearly marks superseded construction information.
10. Dashboard totals reconcile with ledgers, reports, and exports using the same date and status filters. Missing inputs remain visibly incomplete.
11. Database and document backup can be restored into a clean test environment with relationships and permissions intact.
12. An offline report draft syncs once and remains recoverable; sensitive posting is blocked until online validation succeeds.

## 19. Deliverables and working method

Maintain REQUIREMENTS.md, ASSUMPTIONS.md, ARCHITECTURE.md, DATA_MODEL.md, PERMISSIONS.md, ROADMAP.md, and a plain-English README with setup, migrations, demo data, test commands, backup/restore, and deployment steps.

For each milestone, explain what works, how to run it, what you tested, known limitations, and what is next. Keep migrations, seed data, source code, and tests in version control. Provide an environment variable example without secrets. Document third-party licences and recurring service dependencies/cost assumptions.

Use synthetic construction examples with several projects, roles, suppliers, materials, partial deliveries, overdue RFIs, and daily reports. Do not fabricate real EDGE contracts, staff, suppliers, or financial records.

Start now with the short discovery questions and your recommended MVP boundary. Once the essential answers or explicit assumptions are established, create the planning documents and implement the first working local slice: login → authorised project → material request → approval → purchase order → partial receipt → stock issue → project report. Keep me involved at meaningful operational decisions, and continue routine implementation independently.

## Reference starting points

These are official starting points, not a completed compliance assessment. Recheck current applicability before implementation.

- FTA tax invoice guidance: https://tax.gov.ae/en/content/tax.invoices.aspx
- FTA VAT guides and references: https://tax.gov.ae/en/taxes/vat/guides.references.aspx
- MOHRE Wages Protection System: https://www.mohre.gov.ae/en/guidance-and-awareness-portal-new/wages-protection-system
- MOHRE Occupational Heat Stress Prevention Policy: https://www.mohre.gov.ae/en/guidance-and-awareness-portal-new/the-midday-break

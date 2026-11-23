# ERP scope and build order

As of 2026-11-23, benchmarked against Procore, Odoo and Autodesk Build. A full contractor ERP covers 26
areas across seven stages: 2 are built, 10 partly built. Shared, editable copy for EDGE and the engineering
team: https://claude.ai/artifact/8yTAPepcC1QEyG2AwMoTkr (keep the two in step).

## The BOQ spine

1. **Tender BOQ**: priced by estimating, with supplier and subcontractor quotes behind each rate.
2. **Contract BOQ**: the signed version, frozen as the baseline. *(built)*
3. **Budget**: cost per cost code. *(built, simple)*
4. **Progress**: quantity done to date per BOQ item. *(built)*
5. **Payment application**: work done + approved variations + materials on site, less retention and advance recovery.
6. **Variations**: site instructions and CVIs become variation requests, then approved VOs that change BOQ lines.
7. **Final account**: contract BOQ + approved variations, measured at completion.

## Modules

| # | Stage | Area | What it covers | Procore | Odoo | Status | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Win work | CRM and business development | Leads/opportunities pipeline; clients, developers, consultants; contact log; bid/no-bid; company prequalification packs; win rate | Directory | CRM, Contacts | Not started | Later |
| 2 | Win work | Tendering and estimating | Tender register; documents and addenda; pre-tender clarifications; take-off import (CostX/Excel); rate build-up (labour, plant, material, subcontract); rate library; enquiries; bid levelling; markup vs margin; tender approval; won/lost; tender BOQ becomes contract BOQ | Bid Management, Estimating | Sales; third-party BOQ apps | Not started | Later |
| 3 | Commercial | Contracts | Main contract, LOA/LOI, subcontracts, supply agreements; bonds and insurances with expiry; contract documents; key dates and time-bar register; amendments | Prime Contracts, Commitments | Sales, Sign; third-party | Partly built | Now |
| 4 | Commercial | Change management | Site instructions, CVIs, engineer's instructions; potential changes; variation quotations; approved VOs as BOQ changes; daywork / T&M sheets; back-to-back subcontract changes | Change Events, Change Orders, Instructions, T&M Tickets | Third-party | Not started | Now |
| 5 | Commercial | Claims and EOT | Delay events from daily reports and RFIs; notices within contract time limits; EOT submissions; prolongation cost; claim register | Change Events, Correspondence | None | Not started | Now |
| 6 | Commercial | Budget and cost control | Budget by cost code/WBS; commitments (POs, subcontracts, hire); actual costs; forecast to complete / at completion; monthly CVR; contingency; project P&L | Budget, Direct Costs, Cost Forecasting | Analytic accounting, Budgets; third-party job costing | Partly built | Now |
| 7 | Commercial | Client billing and cash | Payment applications from measured BOQ; materials on site; applied vs certified vs paid; retention; advance recovery; invoices; receivables ageing; cash-flow forecast; final account | Invoicing, Pay | Invoicing; third-party progress billing | Not started | Now |
| 8 | Commercial | Accounting, payroll and tax | GL, AP, AR, bank, VAT, fixed assets, payroll, WPS: stay in EDGE's accounting/payroll software, fed by exports | Accounting Integrations | Accounting, Payroll | Not started | Integrate |
| 9 | Supply chain | Procurement | Supplier registration/prequal; MRs; RFQs; quotation comparison; POs and approvals; expediting; long-lead schedule linked to programme and submittals; price agreements; supplier rating | Commitments, Bidding | Purchase | Partly built | Next |
| 10 | Supply chain | Inventory and logistics | Warehouses and site stores; receipts, issues, transfers; returns; stock counts; wastage; reconciliation against BOQ | Partner apps | Inventory | Built | Next |
| 11 | Supply chain | Subcontractor management | Prequal and document expiry; packages and BOQ; monthly claims and certificates; retention; back-charges; performance rating | Prequalification, Commitments, Subcontractor Invoicing | Purchase; third-party | Not started | Now |
| 12 | Resources | Workforce and labour | Employees and document expiry (passport, visa, Emirates ID, labour card); trade tests; camps and transport; crews; attendance (biometric import); timesheets by cost code; overtime; productivity; planned vs actual manpower; payroll inputs | Timesheets, Crews, Resource Planning, Timecard | Employees, Attendances, Timesheets, Planning | Not started | Next |
| 13 | Resources | Plant and equipment | Owned/hired register; allocation; hire and off-hire; utilisation; fuel; maintenance; third-party inspection certificates; breakdowns; cost charging; small tools | Equipment | Maintenance, Fleet, Rental | Not started | Next |
| 14 | Delivery | Planning and scheduling | P6 baseline and revisions; WBS; activity progress; look-aheads; constraints; recovery programmes; delay analysis support; manpower loading | Schedule | Project, Planning | Partly built | Next |
| 15 | Delivery | Document control and correspondence | Drawings; specifications; transmittals; letters in/out with numbering; filed emails; distribution matrix; minutes of meetings and actions | Drawings, Specifications, Documents, Transmittals, Correspondence, Emails, Meetings | Documents, Sign | Partly built | Now |
| 16 | Delivery | Design and BIM coordination | Shop/coordination drawings; design deliverables; clash issues; model viewing; as-builts | Coordination Issues, Models | None | Not started | Later |
| 17 | Delivery | RFIs and submittals | RFIs; submittals, samples, mock-ups with consultant codes; ordering blocked until approved | RFIs, Submittals | None native | Built | Done |
| 18 | Delivery | Site operations | Daily log; photos with location; weather; visitors; deliveries; observations; tasks; custom forms and checklists | Daily Log, Photos, Observations, Tasks, Forms | Field Service, Project | Partly built | Next |
| 19 | Delivery | Quality (QA/QC) | Quality plan; ITPs; WIR/MIR with consultant result; checklists; NCRs and corrective actions; lab tests; calibration; audits | Inspections, Observations | Quality | Not started | Next |
| 20 | Delivery | Health, safety and environment | Risk assessments, method statements; permits to work; toolbox talks; inductions; incidents and near misses; observations and inspections; PPE; man-hours and incident rates; waste | Incidents, Inspections, Observations, Action Plans, Safety Hub | Third-party | Partly built | Next |
| 21 | Delivery | Authorities and permits (UAE) | Building permit; NOCs (DEWA, Civil Defence, RTA, municipality, telecom); inspections; completion certificates; utility connections; tracking only | Forms | None | Not started | Next |
| 22 | Close-out | Handover and close-out | Snag list; T&C; O&M manuals; as-builts; warranties; spare parts and training; completion/taking-over certificates; DLP defects; retention release; lessons learned | Punch List, Warranties | None native | Not started | Next |
| 23 | Company | Dashboards and reports | Owner overview; KPIs; monthly client progress report; management reports; order book; cash position; custom reports | Analytics, Reports | Dashboards, Spreadsheet | Partly built | Now |
| 24 | Company | Collaboration, mobile and portals | Approvals inbox; email/WhatsApp notifications; offline mobile drafts; client, consultant, subcontractor, supplier portals; e-signature | Mobile app, Directory | Portal, Sign, Discuss | Partly built | Later |
| 25 | Company | Administration and platform | User, role and master-data screens; project templates; numbering; forms and workflow builder; Arabic; two-step sign-in; audit; backups; file and photo storage; integration API | Company/Project Admin | Settings, Studio | Partly built | Now |
| 26 | Company | Company compliance and assets | Licence, classification, ISO, insurance certificates with expiry; vehicles; IT assets; document library | Documents | Documents, Fleet | Not started | Later |

## What the benchmark added

- **Win work:** CRM pipeline; estimating with rate build-up and bid levelling.
- **Commercial:** potential changes and daywork sheets; claims and EOT register with notice time limits; CVR and forecast at completion; receivables.
- **Resources:** workforce with UAE documents, camps and transport; plant and equipment with hire, off-hire and inspection certificates.
- **Delivery:** letters, transmittals, meeting minutes; design/BIM coordination; observations, photos, custom checklists; authority NOCs.
- **Close-out:** snag list; warranties register.
- **Company:** portals; forms and workflow builder; company licence and certificate expiry.

Deliberately different from those products: runs on EDGE's own server; follows UAE practice (FIDIC, CVIs,
authority NOCs, WPS through payroll); Primavera P6 stays the planning tool.

## Build order

1. **Phase 1, now:** contracts (time-bar register), change management (SI, CVI, VO, dayworks), claims and EOT,
   subcontractor management, client billing and cash, budget with CVR and forecast, letters/transmittals/minutes,
   admin screens with file and photo storage, monthly client report.
2. **Phase 2, next:** workforce and labour, plant and equipment, QA/QC, HSE, site photos/observations/checklists,
   procurement RFQs and comparison, inventory returns and counts, authorities and permits, handover, scheduling constraints.
3. **Phase 3, later:** CRM, tendering and estimating, design/BIM coordination, portals and offline mobile,
   company compliance and assets, accounting and payroll integration.

## Out of scope

General ledger, VAT returns, payroll, WPS and e-invoicing stay in EDGE's accounting and payroll software. The
ERP exports the figures they need and does not automate tax or payroll rules without the official source and
EDGE's sign-off.

## Open questions for EDGE

- CVI meaning at EDGE and the reply period in EDGE's contracts.
- Which contract forms EDGE signs (FIDIC 1987, FIDIC 1999, client bespoke).
- A sample Excel BOQ and a sample P6 export (.xer).
- How progress is measured for payment: BOQ quantity, % per item, or milestone.
- Retention and advance payment terms: per contract or a company default.
- Which accounting software receives the exports, and in what format.

## Sources

Vendor sites could not be opened from the build environment; tool names come from search results on their own sites.

- Procore: https://www.procore.com/products, https://www.procore.com/what-is-procore, https://support.procore.com/products
- Autodesk Forma Build (formerly Autodesk Construction Cloud): https://www.autodesk.com/products/forma-build/overview, https://learnacc.autodesk.com/page/build-cost-management
- Odoo has no construction app of its own; third-party apps add it, e.g. https://apps.odoo.com/apps/modules/19.0/sdlc_construction_management, https://apps.odoo.com/apps/modules/18.0/odoo_job_costing_management

# ERP scope and build order

As of 2026-11-23 (updated after the contract, BOQ and programme slice). The ERP covers a project from tender to final account in 13 modules. About a third is
built; the commercial chain (BOQ, variations, payments) is the main gap. Shared copy for EDGE and the
engineering team: https://claude.ai/artifact/8yTAPepcC1QEyG2AwMoTkr (keep the two in step).

## The BOQ spine

1. **Tender BOQ**: priced by estimating, with supplier and subcontractor quotes behind each rate.
2. **Contract BOQ**: the signed version, frozen as the baseline.
3. **Budget**: each BOQ line mapped to cost codes (materials, labour, subcontract, plant).
4. **Progress**: quantity or % done measured against BOQ lines, not only overall %.
5. **Payment application**: work done + approved variations + materials on site, less retention and advance recovery.
6. **Variations**: site instructions and CVIs become variation requests, then approved variation orders that
   add or change BOQ lines. Pending and approved stay separate.
7. **Final account**: contract BOQ + approved variations, measured at completion.

Cost flows the other way: POs, subcontract certificates and labour cost post against the same cost codes, so
every project shows cost vs budget and expected profit at completion.

## Modules

| # | Module | What it covers | Key records | Status | Already built |
| --- | --- | --- | --- | --- | --- |
| 1 | Tenders and clients | Contacts, tender register, bid/no-bid, clarifications, estimating, won/lost reason | Company, contact, tender, estimate, priced BOQ | Not started | Companies as master data only |
| 2 | Contracts | Value and dates, retention %, advance, liquidated damages, defects period, bonds and insurances with expiry, notice deadlines | Contract, contract BOQ, guarantee, insurance, key date | Not started | Contract value on the project |
| 3 | Planning | Programme and milestones, 2- and 6-week look-aheads, long-lead items, budget by cost code | Activity, milestone, budget line | Partly built | P6 baseline import (XER or Excel activity list); site progress per activity; S-curve, days behind, forecast finish; 2- and 6-week look-aheads; re-baselining keeps progress |
| 4 | Consultant paperwork | Drawings, RFIs, submittals, samples, mock-ups, transmittals, letters, minutes and actions, site instructions, CVIs, authority approvals (status only) | Drawing revision, RFI, submittal, transmittal, letter, MoM action, SI, CVI | Partly built | Drawings, RFIs, submittals with per-consultant codes |
| 5 | Site management | Daily reports, photos, labour attendance, plant, deliveries, weekly client report | Daily report, attendance, plant log | Partly built | Daily reports, owner overview, quantities done to date per BOQ item |
| 6 | Materials and procurement | Requests, approvals, POs, receipts, stock, transfers, issues, quotation comparison, invoice matching, returns | MR, PO, receipt, stock movement, invoice | Built | All except quotation comparison, invoice matching, returns |
| 7 | Subcontractors and labour | Prequalification, licence/insurance expiry, packages and their BOQ, monthly claims, certification, retention, back-charges, manpower | Subcontract, claim, certificate, back-charge | Not started | Subcontractors as companies; manpower in daily reports |
| 8 | Variations and claims | SI or CVI to variation request to quotation to approved VO; extension of time claims from recorded delays | Instruction, variation, VO, EOT claim | Not started | RFIs flag possible variations |
| 9 | Money | Payment applications, applied vs certified vs paid, retention, advance recovery, cash forecast, cost vs budget, profit at completion | Payment application, certificate, invoice, receipt, forecast | Not started | None |
| 10 | Quality | ITPs, work and material inspection requests with consultant result, NCRs, test results | ITP, WIR, MIR, NCR | Not started | Inspections noted in daily reports |
| 11 | Safety | Incidents, permits to work, toolbox talks, inspections, monthly statistics | Incident, permit, toolbox talk | Partly built | Incidents in daily reports |
| 12 | Handover and close-out | Snagging, T&C, O&M manuals, as-builts, warranties, completion certificates, defects period, final account, retention release | Snag, T&C record, handover document, defect | Not started | None |
| 13 | Company-wide | Owner overview, users and roles, admin screens, staff document expiry, notifications, file and photo storage, audit, backups | User, role, file, audit event | Partly built | Overview, roles, audit trail, backups; no admin screens or file storage |

## Build order

1. **Contract and BOQ**: contract register, guarantees and insurances with expiry, contract BOQ imported from Excel, budget by cost code.
2. **Site instructions, CVIs and variations**: instruction log with reply deadlines, variation requests, approved VOs as BOQ changes.
3. **Payment applications and cash**: monthly application from BOQ progress, certificates, retention, cash in vs out.
4. **Subcontractors and labour**: packages, claims, certification, back-charges, attendance.
5. **Quality, safety and handover**: ITPs, WIR/MIR, NCRs, permits, snagging, handover documents.
6. **Tenders and estimating**: tender register and priced BOQ that becomes the contract BOQ on award.

Admin screens and file/photo storage can be slotted in between; until then data is loaded through the CSV import.

## Out of scope

General ledger, VAT returns, payroll, WPS and e-invoicing stay in EDGE's accounting and payroll software. The
ERP exports the figures they need and does not automate tax or payroll rules without the official source and
EDGE's sign-off.

## Open questions for EDGE

- CVI is read as Confirmation of Verbal Instruction. Is that EDGE's meaning, and what reply period do EDGE's contracts set?
- Which contract forms does EDGE sign (FIDIC 1987, FIDIC 1999, client bespoke)?
- A sample Excel BOQ, to build the import.
- How progress is measured for payment: BOQ quantity, % per item, or milestone.
- Retention and advance payment terms: per contract or a company default.
- Which accounting software receives the exports, and in what format.

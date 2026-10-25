# Discovery — questions for EDGE and recommended MVP boundary

Status: **open**. Answers go into `docs/REQUIREMENTS.md` as *confirmed*. Until then, the
reversible defaults in `docs/ASSUMPTIONS.md` apply. None of these questions blocks the local
prototype.

## The 10 questions

**A. Size and people**

1. **How many** active sites, offices, warehouses/yards, office staff, site staff and workers do you
   have today? Roughly how many people would actually log in, and on what devices: their own
   phones, shared site tablets, or office laptops?

**B. Priorities**

2. **Which three operational problems should the system fix first?** For example: materials arriving
   late; nobody knowing what stock is on which site; purchases approved informally on WhatsApp;
   PO and delivery quantities not matching invoices; cost overruns found too late; overdue RFIs.

**C. How you work today**

3. **Can you share redacted copies of your current registers and forms?** That means the material
   request, LPO/PO, delivery note/GRN, store issue slip, transfer note and stock register, plus your
   document numbering formats (for example, `EDGE/PO/2026/0001`).
4. **Who approves what, and up to what value?** For example: does the PM approve every site request?
   Up to what PO value can the PM, operations manager and director each approve? How are emergency
   purchases handled? Can anyone approve their own request today?

**D. Existing systems**

5. **What accounting, payroll, scheduling, email and document storage do you use?** For example:
   Tally, Zoho Books, QuickBooks, SAP Business One or Odoo; Primavera P6 or MS Project;
   Microsoft 365 or Google Workspace; SharePoint, Google Drive or a file server. Should accounting
   and payroll **stay in those systems** (our assumption), or eventually move into this platform?

**E. Who gets access**

6. **Internal staff only for now?** When, if ever, should clients, consultants, suppliers or
   subcontractors log in, and for what (RFI responses, submittals, delivery confirmations)?

**F. Stock and cost rules (needs your accountant)**

7. **When does material become a project cost:** on delivery to site, or when issued to the work?
   Which **inventory valuation method** does your accountant use (weighted average, FIFO,
   project-specific purchase)? Do you keep stock in site stores today, or only in a central yard?

**G. Site conditions**

8. **What is site connectivity like** (mobile data, Wi-Fi, dead zones)? Are devices shared between
   foremen? Which languages do site users read best? Do any documents need to be in Arabic or be
   bilingual?

**H. Hosting, budget and security**

9. **Where should the system run, and who looks after it?** Options include a cloud provider (with
   or without a UAE region), your own server, or a managed service. Give a rough monthly budget.
   Are there client or contract requirements on data location? Would you like sign-in with
   Microsoft 365 accounts?

**I. A real example**

10. **Can you walk us through one real recent purchase**, from the site asking for material to the
    supplier being paid, with the redacted documents at each step? Include anything that went
    wrong, such as short delivery, damaged goods, a price change or late payment.

## Recommended MVP boundary (Phase 1)

**In scope.** These are built now as a working local prototype on synthetic data:

| Area | Included |
|---|---|
| Access | Login, roles, project membership, server-side permission checks, price/cost redaction, audit trail |
| Masters | Projects, sites, stock locations (warehouse / site store / transit), cost-code library, items with unit conversions, suppliers |
| Material requests | Draft → approval → coverage tracking (reserved / on order / in transit / issued / uncovered) |
| Approvals | Configurable rules by document type, value band and project; sequential steps; no self-approval; rejection reasons; reapproval after revision |
| Purchasing | PO from request shortages, VAT per line, approval by value, revision, short-close |
| Receiving | Partial deliveries, accepted vs rejected quantities, delivery note ref, auto-reservation for the request |
| Inventory | Append-only stock ledger, balances by status, reservations, issues against approved requests, transfers with in-transit + discrepancy workflow, stock card |
| Reporting | Action dashboard ("needs attention"), project material & procurement report with drill-down and CSV export |

**Deliberately out of Phase 1** (see `docs/ROADMAP.md`): supplier RFQs and quotation comparison,
invoice three-way matching and payments, attendance, daily reports, RFIs, drawings and submittals,
QA/QC, HSE, scheduling, CRM and estimating, subcontracts, payroll, accounting exports beyond CSV,
external portals, offline mode, file attachments, and AI.

Brief §17 lists attendance, daily reports and the RFI register in Phase 1. I recommend
building them as the **next three slices** of Phase 1, after you confirm the procurement-to-stock
slice is right. Each needs its own answers (Q1, Q2, Q8).

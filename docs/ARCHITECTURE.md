# Architecture

## 1. Build vs. extend an existing ERP

We briefly compared building a custom system with extending an established open-source ERP.
**Licence terms and prices change, so check them before any decision.**

| | Custom modular monolith (chosen) | Extend ERPNext (Frappe) | Extend Odoo |
|---|---|---|---|
| Licence | EDGE owns the code | GPL-3.0 (open source) | Community LGPL-3. Many modules are Enterprise-only with a per-user subscription. |
| Fits standard buying, stock and accounting | Must be built | Strong: material requests, stock, buying and accounting exist | Strong, especially accounting |
| Fits construction workflows (MR → reservation → PO by cost code, RFIs, drawings, subcontract certification, site-first mobile) | Designed for it | Possible with substantial customisation. Upgrades must be managed. | Possible via add-ons or customisation. Version upgrades are known to be effortful. |
| Accounting | Stays in EDGE's existing system (export) | Could replace the accounting package | Could replace the accounting package |
| Up-front cost | Highest (development) | Lower | Lower to medium (licences plus partner) |
| Long-term risk | Needs a maintainer and tests | Customisations drift from core releases | Licence cost and partner dependency |

**Recommendation: a custom modular monolith.**

- The brief's core value is construction-specific linking (site request ↔ reservation ↔ PO ↔
  receipt ↔ issue ↔ cost code ↔ schedule activity ↔ RFI). That is exactly where a generic ERP
  needs the most customisation.
- Accounting and payroll should stay in EDGE's existing software for now (brief §13). That removes
  the biggest reason to adopt a full ERP.
- EDGE keeps full ownership, and the data model can follow EDGE's processes.

**Trade-off and decision point.** If EDGE prefers lower build cost and can accept standard ERP
workflows, ERPNext is the strongest alternative. This is reversible now and expensive later.
Please confirm.

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict), Node.js 22 LTS | One language for server and browser. Large talent pool. |
| API | Fastify 5 | Mature, fast, good plugin ecosystem (cookies, rate limits, static files) |
| Database | PostgreSQL 16 | Transactions, row locks, CHECK constraints, triggers, numeric precision |
| ORM / migrations | Drizzle ORM + drizzle-kit (SQL migrations committed to git) | Typed queries close to SQL. Migrations are plain SQL you can read. |
| Validation | Zod | Every request body and query is validated on the server |
| Money and quantity maths | decimal.js + Postgres `numeric` | No floating-point errors |
| Passwords | Argon2id via `@node-rs/argon2` | Established library. No custom crypto. |
| Web UI | React 19 + React Router 7, built with Vite | Single-page app served by the same server in production |
| Tests | Vitest (integration tests against a real Postgres) + Playwright (browser journey) | Tests the real SQL, locks and constraints |

Versions are pinned in `package-lock.json`. We deliberately chose established major versions
(for example TypeScript 5.9, Vite 7, Vitest 3) over brand-new ones.

## 3. Structure (modular monolith)

```
server/
  app.ts            HTTP app: auth hook, CSRF guard, error mapping, static web in production
  routes.ts         REST endpoints (thin: validate → call service)
  auth/             permissions catalogue, role templates, sessions, actor & scope checks
  services/         business logic, each operation one DB transaction
    stock.ts          ledger posting, balance locks, reservations, valuation
    materialRequests.ts, approvals.ts, purchasing.ts, inventory.ts, reports.ts
  lib/              decimals, dates (Asia/Dubai), numbering, CSV, units, VAT codes, audit, errors
  db/               schema.ts, migrations/, seeds
web/src/            React UI (pages/, ui.tsx, api.ts)
tests/              integration tests per acceptance scenario
e2e/                Playwright browser journey
```

**Rules.** Routes never touch tables directly for business actions. Services authorise first
(permission + project scope) and then work inside a single transaction.

## 4. Key mechanisms

**Stock ledger.** `stock_movements` is append-only (a Postgres trigger rejects UPDATE and DELETE).
`stock_balances` holds the running quantity per item, location and status, with `CHECK (qty >= 0)`.
Both are written in the same transaction by `postMovement()`.

**Concurrency.**

- Before checking availability, a service locks the balance row (`SELECT … FOR UPDATE`). A second
  user issuing the same stock waits, then sees the reduced balance.
- Locks are taken in item-id order to avoid deadlocks.
- If a deadlock or serialisation error does occur, the API returns 409 "please retry".

**Idempotency.** Receipts, issues and transfers carry a client-generated `idempotencyKey`, which
is unique in the DB. A retry returns the original document. A race between two identical
requests resolves to one document.

**Numbering.** `document_sequences` is incremented with an UPSERT under a row lock. The format is
`PREFIX-YYYY-NNNNN` (Dubai year). Numbers are never reused after cancellation.

**Optimistic concurrency.** Draft documents carry a `version`. A stale save returns 409.

**Approvals.** Rules (`approval_rules`) are matched by type, project and amount. Each step names a
role. The document's `revision` is recorded on each decision; revising a document supersedes open or
approved requests.

**Project scoping.** `Actor` = user + roles + permissions + project ids. Every service checks
`requireProject()`. Out-of-scope records return **404** (not 403) so their existence is not
revealed. Prices and costs are removed from responses for roles without `rates.view` / `cost.view`.

## 5. Cost recognition (Phase 1)

Each purchase is counted once at each stage; the stages are never summed together as "expenses".

| Stage | Record | Meaning in reports |
|---|---|---|
| PO approved | `purchase_order_lines` | **Commitment** (value excl. VAT, less cancelled balances) |
| Goods accepted | `goods_receipt_lines` + ledger `receipt` | **Inventory** (moves from open commitment to stock). Not project cost. |
| Rejected goods | ledger `receipt_rejected` (zero value) | Held for return. Not inventory value, not cost. |
| Transfer | ledger dispatch and receipt (zero value change) | Location change only. No cost and no double count. |
| Issue to work | `stock_issue_lines` + ledger `issue` | **Project material cost**, at moving-average cost (A-04, A-10) |
| Transfer loss write-off | ledger `discrepancy_writeoff` | Inventory loss. Not charged to a project. |
| Invoice / payment | — | Phase 2. Will be matched to receipts and will not create new cost. |

## 6. Security

- httpOnly, SameSite=Lax session cookie (`Secure` behind HTTPS). Sessions are stored hashed (SHA-256) in the DB.
- Mutating requests need the `x-edge-csrf` header. Browsers cannot send it cross-site without a
  CORS preflight, and the server never allows one.
- Login is rate-limited (10 per minute per IP) and accounts lock for 15 minutes after 5 failures.
- Logs redact cookies and auth headers. Audit events never contain passwords, tokens, salaries,
  IDs or bank details.
- Request body limit is 1 MB. All inputs are validated with Zod. All SQL is parameterised.
- **Not yet:** MFA/SSO, file uploads (with type/size checks, private storage, signed URLs and
  malware scanning), and a security headers/CSP review. These are required before production.

## 7. Environments, deployment, backup

- **Environments.** Separate development, staging and production databases and secrets. Demo
  data is refused in production (`ALLOW_DEMO_SEED`).
- **Deployment (proposal, pending Q9).** One Node.js process (or container) behind an HTTPS
  reverse proxy, plus a managed PostgreSQL with automated daily backups and point-in-time
  recovery. Run `npm run build`, then `npm run db:migrate`, then `npm start`.
- **Backups.** `scripts/backup.sh` writes a `pg_dump` custom-format file plus a checksum.
  `scripts/restore.sh` restores into an empty database and runs `scripts/verify-restore.sql`
  (ledger = balances, triggers present, FKs valid, users/roles intact). It was tested on a
  restore into a clean database.
- **Recovery targets (RPO/RTO)** must be agreed with EDGE before production.
- **Not production-ready yet.** Access isolation is tested, backup restoration is tested, and
  **user acceptance testing with EDGE staff has not happened**.

## 8. AI (future)

None in Phase 1. If AI is added later, it only drafts or summarises, with human verification. No
confidential data goes to external services without an approved configuration. It never approves
anything.

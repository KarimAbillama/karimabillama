# EDGE SCM — Construction CRM & ERP

A connected operations system for EDGE SCM Building Contracting (Dubai). Information is entered
once and reused: a project, supplier, item or cost code is one record shared by every workflow.

> **Status: Phase 1, first working slice. Local prototype on synthetic demo data.**
> It is **not production-ready**: user acceptance testing with EDGE staff, MFA/SSO and the hosting
> decision are still open. See `docs/ROADMAP.md`.

## What works today

The full **site-to-stock-to-cost** journey, with real database records, permissions and tests:

1. **Sign in.** Each person only sees the projects they are assigned to. Supplier prices and costs
   are hidden from roles that should not see them, such as site engineers, foremen and storekeepers.
2. **Material request.** A site engineer requests materials for a site, a cost code and a
   required date, then submits it.
3. **Approval.** The project manager approves or rejects it (a reason is required to reject).
   Nobody can approve their own request. Larger POs need more approval steps.
4. **Reserve or order.** Stores reserve available stock for the request. Procurement raises a
   purchase order for the shortage, and the system blocks ordering more than was requested.
5. **Receive.** The site records a partial delivery against the PO, including rejected items and
   the reason (for example, 50 delivered, 5 cracked). Accepted stock is automatically held for the
   request. Rejected stock is kept separate. The outstanding balance stays open on the PO.
6. **Issue.** Stores issue material to the crew, only against approved requests and only from
   usable stock. That charges the project's cost code.
7. **Transfer.** Stock sent between the warehouse and sites shows as "in transit" until received.
   Shortages become a discrepancy that must be resolved.
8. **Report.** The project report shows committed, received, issued and site-store values. Every
   figure drills down to its documents and exports to CSV. Anything not tracked yet (invoices,
   payments, labour, budget) is shown as **"Not tracked yet"**, never as zero.
9. **"Needs attention" home page.** It lists approvals waiting for you, late deliveries, uncovered
   requests, transfers to receive and low stock, each with its owner and due date.

Every posting is recorded in an append-only stock ledger and audit trail. Mistakes are corrected
by new entries, never by editing history.

Screenshots from the automated browser test are in `docs/screenshots/`.

## Documents

| File | What it is |
|---|---|
| `docs/DISCOVERY.md` | **10 questions for EDGE** and the recommended MVP boundary |
| `docs/ASSUMPTIONS.md` | Every default we chose while waiting for answers, and who should confirm it |
| `docs/REQUIREMENTS.md` | Requirements traced to the brief, plus acceptance-scenario status |
| `docs/ARCHITECTURE.md` | Build-vs-ERP decision, technology, cost recognition, security, backups |
| `docs/DATA_MODEL.md` | Entity relationship diagram and tables |
| `docs/PERMISSIONS.md` | Role × permission matrix and separation of duties |
| `docs/ROADMAP.md` | Phases, next slices, known limitations |
| `docs/THIRD_PARTY.md` | Licences and running-cost assumptions |
| `docs/PRODUCT_BRIEF.md` | The original product brief |

## Run it on your computer

You need **Node.js 22** and **Docker Desktop**, or any PostgreSQL 16 server.

```bash
# 1. Install
npm install
cp .env.example .env            # adjust if your database is elsewhere

# 2. Start the database (creates edge_dev and edge_test)
docker compose up -d

# 3. Create tables and load the synthetic demo data
npm run db:migrate
npm run db:seed

# 4. Start the app
npm run dev
```

Open <http://localhost:5173>. All demo users share the password **`Demo@2026!`** (demo only).

| Sign in as | Role | Try this |
|---|---|---|
| `engineer.marina@demo.edge.test` | Site engineer, project DEMO-101 | Raise a material request, receive a delivery |
| `pm.marina@demo.edge.test` | Project manager, DEMO-101 | Approve requests and POs, view the project report |
| `procurement@demo.edge.test` | Procurement officer, all projects | "Order shortage" from an approved request |
| `stores@demo.edge.test` | Storekeeper | Reserve stock, issue to crews, transfers |
| `ops@demo.edge.test` | Operations manager | Second-level PO approval, resolve transfer discrepancies |
| `director@demo.edge.test` | Director | Third-level approval, company-wide view |
| `foreman.marina@demo.edge.test` | Foreman | Requests only; no prices, no POs |
| `engineer.villa@demo.edge.test` | Site engineer, DEMO-102 | Cannot see DEMO-101 at all |
| `admin@demo.edge.test`, `qs@…`, `accounts@…`, `viewer@…` | Other roles | |

All companies, people, projects and figures in the demo are **invented**.

To start the database again from scratch (development only): `npm run db:reset`.

## Tests

```bash
npm test             # integration tests on a throwaway database (TEST_DATABASE_URL, name must contain "test")
npm run build        # type-check and build the web app
npx playwright install chromium   # once per machine
npm run test:e2e     # full browser journey on desktop and phone sizes; writes docs/screenshots/
```

The tests cover acceptance scenarios 1, 2, 3, 5 and 10, the revision part of 8, approvals, unit
conversions, CSV safety, rate limiting, account lockout and the ledger's append-only guard.
Scenario 11 (restore) is checked with the backup scripts below.

## Backup and restore

```bash
scripts/backup.sh                       # writes backups/edge-<Dubai timestamp>.dump + checksum
scripts/restore.sh backups/edge-….dump postgres://…/empty_db   # restore into an EMPTY database + integrity checks
```

The restore check confirms the following:

- ledger totals match the balances
- the append-only guards are present
- all foreign keys are valid
- users keep their roles and project memberships

Agree recovery targets and schedule automated backups before any production use.

## Deploying (outline, pending the hosting decision)

1. Create a managed PostgreSQL 16 database with automated backups.
2. Set the environment variables from `.env.example`. Use `COOKIE_SECURE=true`, and leave out or
   set `ALLOW_DEMO_SEED=false`.
3. `npm ci && npm run build && npm run db:migrate && npm start`. The server serves the web app
   and API on `PORT`.
4. Put it behind an HTTPS reverse proxy. Never expose it over plain HTTP.
5. Create real users with an import script (admin screens are the next slice).

## Changing the database

1. Edit `server/db/schema.ts`.
2. Run `npm run db:generate` to create a new SQL migration in `server/db/migrations/`.
3. Review the SQL, then run `npm run db:migrate`.

Commit the migration together with the code change.

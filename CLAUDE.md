# Working notes for AI assistants

This repo is EDGE SCM's construction CRM/ERP. Read `docs/PRODUCT_BRIEF.md` (the brief),
`docs/ASSUMPTIONS.md` and `docs/ROADMAP.md` before changing behaviour.

## Non-negotiables

- Authorise on the server, inside services: check the permission (`requirePerm`) and the project
  scope (`requireProject` / `requireLocation`). Out-of-scope records return 404.
- Prices and costs need `rates.view` / `cost.view`. Redact them in API responses, not only in the UI.
- Stock changes only through `postMovement()` in a transaction, after locking balances with
  `lockBalance()`. Never UPDATE or DELETE `stock_movements`, `audit_events`, receipt lines or issue
  lines; post reversals instead.
- Postings (receipts, issues, transfers) take an idempotency key.
- Money and quantities: `decimal.js` and Postgres `numeric`. Never JS floats.
- Business dates are Asia/Dubai calendar dates (`server/lib/dates.ts`).
- Do not invent EDGE policies. Record new defaults in `docs/ASSUMPTIONS.md` with an ID.
- Do not automate VAT, payroll, WPS, e-invoicing or authority rules without the verified official
  source and EDGE sign-off.
- Demo data stays synthetic and obviously labelled.

## Commands

- `npm test`: integration tests. Needs `TEST_DATABASE_URL` with "test" in the name; it is wiped.
- `npm run typecheck`, `npm run build`, `npm run test:e2e`
- Schema change: edit `server/db/schema.ts`, then `npm run db:generate`, then review the SQL.
- Permission matrix doc: `npx tsx scripts/permission-matrix.ts`

## Layout

`server/services/*` holds the business logic; each operation is one transaction.
`server/routes.ts` holds thin HTTP handlers with Zod validation.
`web/src/pages/*` holds the React screens.
Tests are organised per acceptance scenario in `tests/`.

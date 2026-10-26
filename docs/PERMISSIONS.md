# Roles and permissions

Roles, permissions and project scope are **proposed defaults** (assumptions A-17, A-18, A-22, A-23).
Confirm them with EDGE's operations manager.

## How access works

1. A **user** (login account) has one or more **roles**. Each role grants **permissions**.
2. **Project scope.** Company-wide roles (marked *all*) see every project. Other users see only
   projects they are **members** of. Site stores follow project scope. Central warehouses are
   visible to anyone with `stock.view`.
3. **Checks run on the server** for every request: lists, detail pages, direct URLs, reports,
   drill-downs, exports and history. A record outside your scope answers "not found".
4. **Approval** additionally requires the role named on the current approval step. You can never
   approve your own request or two steps of the same request.
5. **Sensitive fields.** Supplier prices and PO values need `rates.view`. Cost figures need
   `cost.view`. Without these, the API returns `null` in their place rather than just hiding them
   in the screen.

## Matrix (generated from `server/auth/roles.ts`)

Regenerate with `npx tsx scripts/permission-matrix.ts`.

| Permission | Meaning | Admin | Dir | Ops | PM | SE | Fore | DC | Proc | Store | QS | Acct | View |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `project.view` | View assigned projects | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `masters.view` | View items, suppliers, locations, cost codes | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `masters.manage` | Create/edit items, suppliers, locations, cost codes | ✔ |  |  |  |  |  |  | ✔ |  |  |  |  |
| `mr.view` | View material requests | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `mr.create` | Create, edit and submit material requests |  |  |  | ✔ | ✔ | ✔ |  |  |  |  |  |  |
| `mr.approve` | Approve or reject material requests (when the approval step names your role) |  | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |
| `mr.allocate` | Reserve stock against approved material requests |  |  |  |  |  |  |  | ✔ | ✔ |  |  |  |
| `po.view` | View purchase orders | ✔ | ✔ | ✔ | ✔ | ✔ |  | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `po.create` | Create, edit, submit and short-close purchase orders |  |  |  |  |  |  |  | ✔ |  |  |  |  |
| `po.approve` | Approve or reject purchase orders (when the approval step names your role) |  | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |
| `rates.view` | See supplier prices and purchase values |  | ✔ | ✔ | ✔ |  |  |  | ✔ |  | ✔ | ✔ |  |
| `stock.view` | View stock balances, ledgers and central warehouses | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `stock.receive` | Post goods receipts |  |  |  |  | ✔ |  |  |  | ✔ |  |  |  |
| `stock.issue` | Issue stock to project work |  |  |  |  |  |  |  |  | ✔ |  |  |  |
| `stock.transfer` | Dispatch and receive stock transfers |  |  |  |  |  |  |  |  | ✔ |  |  |  |
| `stock.adjust` | Resolve transfer discrepancies / write-offs |  |  | ✔ |  |  |  |  |  |  |  |  |  |
| `report.view` | View project reports and dashboards | ✔ | ✔ | ✔ | ✔ | ✔ |  | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `cost.view` | See cost figures in reports |  | ✔ | ✔ | ✔ |  |  |  |  |  | ✔ | ✔ | ✔ |
| `report.export` | Export registers and reports to CSV | ✔ | ✔ | ✔ | ✔ |  |  |  | ✔ | ✔ | ✔ | ✔ |  |
| `audit.view` | View the audit trail | ✔ | ✔ | ✔ |  |  |  |  |  |  |  | ✔ |  |
| `admin.users` | Manage users, roles and project membership | ✔ |  |  |  |  |  |  |  |  |  |  |  |
| `submittal.view` | View submittals, samples and mock-ups and their consultant responses | ✔ | ✔ | ✔ | ✔ | ✔ |  | ✔ | ✔ |  | ✔ |  | ✔ |
| `submittal.manage` | Create submittals, send them to the consultant and record the response |  |  |  | ✔ |  |  | ✔ |  |  |  |  |  |
| `sitereport.create` | Write and submit daily site reports |  |  |  | ✔ | ✔ | ✔ |  |  |  |  |  |  |
| `sitereport.review` | Review daily site reports (accept or return) |  | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |
| `progress.update` | Record weekly project progress (planned vs actual, forecast finish) |  |  | ✔ | ✔ |  |  |  |  |  |  |  |  |
| `rfi.view` | View RFIs and consultant responses | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |  | ✔ |  | ✔ |
| `rfi.create` | Raise and edit RFIs and send them for internal review |  |  |  | ✔ | ✔ |  | ✔ |  |  |  |  |  |
| `rfi.issue` | Review RFIs, issue them to the consultant, record responses and close them |  |  |  | ✔ |  |  | ✔ |  |  |  |  |  |
| `drawing.manage` | Register drawings and record new revisions |  |  |  | ✔ |  |  | ✔ |  |  |  |  |  |
| *Project scope* | | all | all | all | assigned | assigned | assigned | assigned | all | assigned | assigned | all | all |

Abbreviations: Dir = Owner/Director, Ops = Operations Manager, PM = Project Manager, SE = Site
Engineer, Fore = Foreman, Proc = Procurement Officer, Store = Storekeeper, QS = Quantity Surveyor,
Acct = Accountant, View = Management (read-only).

## Planned roles (added with their modules)

| Role | Module |
|---|---|
| Planning engineer | Schedules and look-aheads |
| HR / payroll officer | Employees, attendance approval, payroll inputs. Salary and ID fields restricted to this role. |
| QA/QC engineer | Inspections, NCRs, quarantine release |
| HSE officer | Incidents (restricted), permits, inductions |
| Document controller | Drawings, transmittals, numbering |
| External: client, consultant, subcontractor, supplier | **Disabled** until explicitly configured |

## Separation of duties (built in)

- The requester of an MR or PO cannot approve it.
- Different people must approve consecutive steps.
- Procurement creates POs but cannot approve them, because the procurement officer role has no
  `po.approve`.
- Storekeepers post stock but cannot see supplier prices.
- Only `stock.adjust` holders (Ops Manager) can write off losses.
- An administrator manages users but is not an approver and does not see costs.

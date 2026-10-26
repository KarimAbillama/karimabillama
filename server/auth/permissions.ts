/**
 * Permission catalogue. Permissions are granted to roles; roles are granted to users.
 * Project scope is separate: a user sees a project only if one of their roles is company-wide
 * (`all_projects`) or they are a member of that project. See docs/PERMISSIONS.md.
 */
export const PERMISSIONS = {
  "project.view": "View assigned projects",
  "masters.view": "View items, suppliers, locations, cost codes",
  "masters.manage": "Create/edit items, suppliers, locations, cost codes",
  "mr.view": "View material requests",
  "mr.create": "Create, edit and submit material requests",
  "mr.approve": "Approve or reject material requests (when the approval step names your role)",
  "mr.allocate": "Reserve stock against approved material requests",
  "po.view": "View purchase orders",
  "po.create": "Create, edit, submit and short-close purchase orders",
  "po.approve": "Approve or reject purchase orders (when the approval step names your role)",
  "rates.view": "See supplier prices and purchase values",
  "stock.view": "View stock balances, ledgers and central warehouses",
  "stock.receive": "Post goods receipts",
  "stock.issue": "Issue stock to project work",
  "stock.transfer": "Dispatch and receive stock transfers",
  "stock.adjust": "Resolve transfer discrepancies / write-offs",
  "report.view": "View project reports and dashboards",
  "cost.view": "See cost figures in reports",
  "report.export": "Export registers and reports to CSV",
  "audit.view": "View the audit trail",
  "admin.users": "Manage users, roles and project membership",
  "submittal.view": "View submittals, samples and mock-ups and their consultant responses",
  "submittal.manage": "Create submittals, send them to the consultant and record the response",
  "sitereport.create": "Write and submit daily site reports",
  "sitereport.review": "Review daily site reports (accept or return)",
  "progress.update": "Record weekly project progress (planned vs actual, forecast finish)",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

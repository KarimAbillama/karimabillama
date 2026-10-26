import type { Permission } from "./permissions.js";

/**
 * Default role templates (PROPOSED — confirm with EDGE; see docs/PERMISSIONS.md).
 * `allProjects` roles see every project; others only see projects they are members of.
 */
export interface RoleTemplate { key: string; name: string; description: string; allProjects: boolean; permissions: Permission[] }

const VIEW_BASICS: Permission[] = ["project.view", "masters.view", "mr.view", "po.view", "stock.view", "report.view"];

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: "admin", name: "Administrator", allProjects: true,
    description: "System configuration, users and roles. Not an approver by default.",
    permissions: [...VIEW_BASICS, "masters.manage", "admin.users", "audit.view", "report.export", "submittal.view"],
  },
  {
    key: "director", name: "Owner / Director", allProjects: true,
    description: "Company-wide visibility including costs; final approver for high-value purchases.",
    permissions: [...VIEW_BASICS, "rates.view", "cost.view", "po.approve", "mr.approve", "report.export", "audit.view", "submittal.view", "sitereport.review"],
  },
  {
    key: "operations_manager", name: "Operations Manager", allProjects: true,
    description: "Oversees all projects; second-level purchase approval.",
    permissions: [...VIEW_BASICS, "rates.view", "cost.view", "po.approve", "mr.approve", "report.export", "stock.adjust", "audit.view", "submittal.view", "sitereport.review", "progress.update"],
  },
  {
    key: "project_manager", name: "Project Manager", allProjects: false,
    description: "Runs assigned projects; approves material requests and first-level purchases.",
    permissions: [...VIEW_BASICS, "mr.create", "mr.approve", "po.approve", "rates.view", "cost.view", "report.export", "submittal.view", "submittal.manage", "sitereport.create", "sitereport.review", "progress.update"],
  },
  {
    key: "site_engineer", name: "Site Engineer", allProjects: false,
    description: "Raises material requests and receives deliveries on assigned sites. No supplier prices.",
    permissions: [...VIEW_BASICS, "mr.create", "stock.receive", "submittal.view", "sitereport.create"],
  },
  {
    key: "foreman", name: "Foreman", allProjects: false,
    description: "Raises material requests for the crew. No prices, costs or salaries.",
    permissions: ["project.view", "masters.view", "mr.view", "mr.create", "stock.view", "sitereport.create"],
  },
  {
    key: "document_controller", name: "Document Controller", allProjects: false,
    description: "Keeps the submittal, sample and mock-up register for assigned projects and records consultant responses.",
    permissions: [...VIEW_BASICS, "submittal.view", "submittal.manage"],
  },
  {
    key: "procurement_officer", name: "Procurement Officer", allProjects: true,
    description: "Sources and orders materials; manages suppliers. Cannot approve own POs.",
    permissions: [...VIEW_BASICS, "po.create", "rates.view", "mr.allocate", "masters.manage", "report.export", "submittal.view"],
  },
  {
    key: "storekeeper", name: "Storekeeper", allProjects: false,
    description: "Receives, reserves, issues and transfers stock at assigned stores. No supplier prices.",
    permissions: [...VIEW_BASICS, "stock.receive", "stock.issue", "stock.transfer", "mr.allocate", "report.export"],
  },
  {
    key: "quantity_surveyor", name: "Quantity Surveyor", allProjects: false,
    description: "Commercial view of assigned projects (costs, commitments).",
    permissions: [...VIEW_BASICS, "rates.view", "cost.view", "report.export", "submittal.view"],
  },
  {
    key: "accountant", name: "Accountant", allProjects: true,
    description: "Read-only commercial view for reconciliation and exports.",
    permissions: [...VIEW_BASICS, "rates.view", "cost.view", "report.export", "audit.view"],
  },
  {
    key: "management_viewer", name: "Management (read-only)", allProjects: true,
    description: "Read-only dashboards and reports across all projects.",
    permissions: [...VIEW_BASICS, "cost.view", "submittal.view"],
  },
];

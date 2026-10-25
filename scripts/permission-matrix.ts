// Prints the role × permission matrix as Markdown (used to keep docs/PERMISSIONS.md in sync).
import { PERMISSIONS } from "../server/auth/permissions.js";
import { ROLE_TEMPLATES } from "../server/auth/roles.js";

const short: Record<string, string> = {
  admin: "Admin", director: "Dir", operations_manager: "Ops", project_manager: "PM", site_engineer: "SE", foreman: "Fore",
  procurement_officer: "Proc", storekeeper: "Store", quantity_surveyor: "QS", accountant: "Acct", management_viewer: "View",
};
const head = `| Permission | Meaning | ${ROLE_TEMPLATES.map((r) => short[r.key] ?? r.key).join(" | ")} |`;
const sep = `|---|---|${ROLE_TEMPLATES.map(() => ":-:").join("|")}|`;
const rows = Object.entries(PERMISSIONS).map(([p, desc]) =>
  `| \`${p}\` | ${desc} | ${ROLE_TEMPLATES.map((r) => ((r.permissions as string[]).includes(p) ? "✔" : "")).join(" | ")} |`);
const scope = `| *Project scope* | | ${ROLE_TEMPLATES.map((r) => (r.allProjects ? "all" : "assigned")).join(" | ")} |`;
console.log([head, sep, ...rows, scope].join("\n"));

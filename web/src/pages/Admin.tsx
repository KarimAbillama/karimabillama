import { useApi } from "../api";
import { Card, ErrorBox, Loading, Page, fmtDateTime } from "../ui";

interface UserRow { id: string; email: string; fullName: string; jobTitle: string | null; isActive: boolean; lastLoginAt: string | null; roles: string[]; projects: string[] }
interface AuditRow { id: number; at: string; userName: string | null; action: string; entityType: string; entityId: string | null; projectCode: string | null; details: unknown }

export function AdminUsers() {
  const { data, error, loading } = useApi<UserRow[]>("/api/admin/users");
  return (
    <Page title="Users" subtitle="User and role editing screens are planned next; changes are currently made by an administrator in the database seed/import.">
      <ErrorBox error={error} />
      <Card>{loading ? <Loading /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Projects</th><th>Active</th><th>Last sign-in</th></tr></thead>
          <tbody>{data?.map((u) => (
            <tr key={u.id}><td>{u.fullName}<div className="muted small">{u.jobTitle}</div></td><td>{u.email}</td>
              <td>{u.roles.join(", ").replace(/_/g, " ")}</td><td>{u.projects.join(", ") || "All (company-wide role)"}</td>
              <td>{u.isActive ? "Yes" : "No"}</td><td>{fmtDateTime(u.lastLoginAt)}</td></tr>))}
          </tbody>
        </table></div>)}
      </Card>
    </Page>
  );
}

export function AuditLog() {
  const { data, error, loading } = useApi<AuditRow[]>("/api/audit?limit=200");
  return (
    <Page title="Audit trail" subtitle="Append-only record of every posting, approval and export (latest 200).">
      <ErrorBox error={error} />
      <Card>{loading ? <Loading /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>User</th><th>Action</th><th>Record</th><th>Project</th><th>Details</th></tr></thead>
          <tbody>{data?.map((r) => (
            <tr key={r.id}><td>{fmtDateTime(r.at)}</td><td>{r.userName ?? "system"}</td><td>{r.action}</td><td>{r.entityType}</td><td>{r.projectCode ?? ""}</td>
              <td className="small mono">{r.details ? JSON.stringify(r.details) : ""}</td></tr>))}
          </tbody>
        </table></div>)}
      </Card>
    </Page>
  );
}

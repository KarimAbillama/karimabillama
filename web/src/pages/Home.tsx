import { Link } from "react-router-dom";
import { useApi } from "../api";
import { Card, Empty, ErrorBox, Loading, Page, fmtDate, useApp } from "../ui";

interface Action { kind: string; title: string; detail: string; due: string | null; overdue: boolean; owner: string | null; link: string; projectCode: string | null }
interface Dash { today: string; actions: Action[]; projects: { id: string; code: string; name: string; status: string }[] }

const KIND_LABEL: Record<string, string> = {
  approval: "Approval", my_draft: "My document", mr_uncovered: "Material shortage", po_delivery: "Delivery",
  transfer_in_transit: "Transfer", discrepancy: "Discrepancy", low_stock: "Low stock",
};

export function Home() {
  const { me, projectId, ref, can } = useApp();
  const { data, error, loading } = useApi<Dash>("/api/dashboard");
  const project = ref.projects.find((p) => p.id === projectId);
  const actions = (data?.actions ?? []).filter((a) => !project || !a.projectCode || a.projectCode === project.code);
  return (
    <Page title={`Good day, ${me.fullName.split(" ")[0] === "Demo" ? me.fullName : me.fullName.split(" ")[0]}`} subtitle={`Today in Dubai: ${data?.today ?? "…"}${project ? ` · Filtered to ${project.code}` : ""}`}
      actions={<>
        {can("mr.create") && <Link className="btn primary" to="/material-requests/new">New material request</Link>}
        {can("stock.issue") && <Link className="btn secondary" to="/issues/new">Issue stock</Link>}
        {can("stock.transfer") && <Link className="btn secondary" to="/transfers/new">New transfer</Link>}
      </>}>
      <ErrorBox error={error} />
      <Card title={`Needs attention (${actions.length})`}>
        {loading ? <Loading /> : actions.length === 0 ? <Empty>Nothing needs your attention right now.</Empty> : (
          <ul className="action-list">
            {actions.map((a, i) => (
              <li key={i} className={a.overdue ? "overdue" : ""}>
                <Link to={a.link}>
                  <div className="action-main">
                    <span className="kind">{KIND_LABEL[a.kind] ?? a.kind}</span>
                    {a.projectCode && <span className="tag">{a.projectCode}</span>}
                    <strong>{a.title}</strong>
                  </div>
                  <div className="action-sub muted">
                    {a.detail}{a.owner ? ` · Owner: ${a.owner}` : ""}{a.due ? ` · Due ${fmtDate(a.due)}` : ""}{a.overdue ? " · OVERDUE" : ""}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="My projects">
        <div className="grid cards">
          {(data?.projects ?? []).map((p) => (
            <Link key={p.id} to={`/report?project=${p.id}`} className="project-card">
              <div className="tag">{p.code}</div>
              <div>{p.name}</div>
              <div className="muted small">{p.status}</div>
            </Link>
          ))}
        </div>
      </Card>
    </Page>
  );
}

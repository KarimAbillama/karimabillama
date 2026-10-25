import { useState } from "react";
import { Link } from "react-router-dom";
import { post, useApi } from "../api";
import type { PendingApproval } from "../types";
import { ActionButton, Card, Empty, ErrorBox, Loading, Page, fmtDateTime, fmtMoney } from "../ui";

/** Approve / reject panel shown on a document when the signed-in user may decide its current step. */
export function DecisionPanel({ docId, onDone }: { docId: string; onDone: () => void }) {
  const { data } = useApi<PendingApproval[]>(`/api/approvals/mine?for=${docId}`);
  const [comment, setComment] = useState("");
  const mine = data?.find((p) => p.docId === docId);
  if (!mine) return null;
  return (
    <Card title={`Your decision — step ${mine.stepNo} (${mine.roleKey.replace(/_/g, " ")})`} className="decision">
      <label className="field"><span>Comment (required to reject)</span>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
      </label>
      <div className="actions">
        <ActionButton onClick={async () => { await post(`/api/approvals/${mine.requestId}/decide`, { decision: "approve", comment: comment || undefined }); onDone(); }}>Approve</ActionButton>
        <ActionButton kind="danger" onClick={async () => { await post(`/api/approvals/${mine.requestId}/decide`, { decision: "reject", comment }); onDone(); }}>Reject</ActionButton>
      </div>
    </Card>
  );
}

export function ApprovalsInbox() {
  const { data, error, loading } = useApi<PendingApproval[]>("/api/approvals/mine");
  return (
    <Page title="Approvals waiting for me">
      <ErrorBox error={error} />
      <Card>
        {loading ? <Loading /> : !data?.length ? <Empty>No approvals are waiting for you.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Document</th><th>Project</th><th>Requested by</th><th>Step</th><th className="num">Value (excl. VAT)</th><th>Submitted</th></tr></thead>
            <tbody>{data.map((a) => (
              <tr key={a.requestId}>
                <td><Link to={a.docType === "purchase_order" ? `/purchase-orders/${a.docId}` : `/material-requests/${a.docId}`}>{a.docNumber}</Link></td>
                <td>{a.projectCode}</td><td>{a.requesterName}</td><td>{a.stepNo} · {a.roleKey.replace(/_/g, " ")}</td>
                <td className="num">{a.amount ? fmtMoney(a.amount) : "—"}</td><td>{fmtDateTime(a.requestedAt)}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
    </Page>
  );
}

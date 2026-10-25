import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { get, post, put, useApi, type ApiError } from "../api";
import type { ApprovalRequest, Fulfilment, Item } from "../types";
import { ActionButton, ApprovalHistory, Card, Empty, ErrorBox, Field, Loading, Page, Status, addDays, fmtDate, fmtDateTime, fmtQty, todayDubai, useApp } from "../ui";
import { DecisionPanel } from "./Approvals";
import { History } from "./History";

interface MrRow { id: string; number: string; status: string; revision: number; requiredDate: string; projectCode: string; requesterName: string; createdAt: string; purpose: string | null; lineCount: number }
interface MrLine {
  id: string; lineNo: number; itemId: string; qty: string; costCodeId: string; remarks: string | null; itemCode: string; itemDescription: string; baseUnit: string;
  costCode: string; costCodeName: string; fulfilment: Fulfilment;
  reservations: { id: string; location_code: string; qty: string; qty_consumed: string; status: string; source: string }[];
}
export interface MrDetailData {
  id: string; number: string; status: string; revision: number; version: number; projectId: string; projectCode: string; projectName: string; siteId: string | null;
  siteName: string | null; requiredDate: string; purpose: string | null; requesterName: string; requestedBy: string; createdAt: string; lines: MrLine[]; approvals: ApprovalRequest[];
}

export function MrList() {
  const { projectId, can } = useApp();
  const [status, setStatus] = useState("");
  const qs = new URLSearchParams({ limit: "100", ...(projectId ? { projectId } : {}), ...(status ? { status } : {}) });
  const { data, error, loading } = useApi<MrRow[]>(`/api/material-requests?${qs}`);
  return (
    <Page title="Material requests" actions={can("mr.create") && <Link className="btn primary" to="/material-requests/new">New request</Link>}>
      <div className="filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {["draft", "pending_approval", "approved", "rejected", "cancelled", "closed"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
      </div>
      <ErrorBox error={error} />
      <Card>
        {loading ? <Loading /> : !data?.length ? <Empty>No material requests match these filters.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Number</th><th>Project</th><th>Status</th><th>Required</th><th>Purpose</th><th className="num">Lines</th><th>Requested by</th></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/material-requests/${r.id}`}>{r.number}</Link>{r.revision > 0 && <span className="muted"> rev {r.revision}</span>}</td>
                <td>{r.projectCode}</td><td><Status value={r.status} /></td><td>{fmtDate(r.requiredDate)}</td>
                <td>{r.purpose}</td><td className="num">{r.lineCount}</td><td>{r.requesterName}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
    </Page>
  );
}

interface LineDraft { itemId: string; qty: string; costCodeId: string; remarks: string }

export function useItems() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => { get<Item[]>("/api/items").then(setItems).catch(() => setItems([])); }, []);
  return items;
}

export function ItemSelect({ items, value, onChange }: { items: Item[]; value: string; onChange: (id: string) => void }) {
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const f = filter.toLowerCase();
    return items.filter((i) => i.id === value || !f || i.code.toLowerCase().includes(f) || i.description.toLowerCase().includes(f));
  }, [items, filter, value]);
  return (
    <div className="item-select">
      <input placeholder="Search item…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search item" />
      <select value={value} onChange={(e) => onChange(e.target.value)} required aria-label="Item">
        <option value="">Select item</option>
        {shown.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.description} ({i.baseUnit})</option>)}
      </select>
    </div>
  );
}

export function MrForm() {
  const { id } = useParams();
  const { ref, projectId: selectedProject } = useApp();
  const navigate = useNavigate();
  const items = useItems();
  const [projectId, setProjectId] = useState(selectedProject ?? ref.projects[0]?.id ?? "");
  const [siteId, setSiteId] = useState("");
  const [requiredDate, setRequiredDate] = useState(addDays(todayDubai(), 3));
  const [purpose, setPurpose] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ itemId: "", qty: "", costCodeId: "", remarks: "" }]);
  const [version, setVersion] = useState<number | undefined>();
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    get<MrDetailData>(`/api/material-requests/${id}`).then((m) => {
      setProjectId(m.projectId); setSiteId(m.siteId ?? ""); setRequiredDate(m.requiredDate); setPurpose(m.purpose ?? ""); setVersion(m.version);
      setLines(m.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, costCodeId: l.costCodeId, remarks: l.remarks ?? "" })));
    }).catch(setErr);
  }, [id]);

  const sites = ref.sites.filter((s) => s.projectId === projectId);
  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async (submit: boolean) => {
    setBusy(true); setErr(null);
    try {
      const body = { siteId: siteId || null, requiredDate, purpose: purpose || null, lines: lines.map((l) => ({ ...l, remarks: l.remarks || null })) };
      const saved = id
        ? await put<{ id: string; version: number }>(`/api/material-requests/${id}`, { ...body, version })
        : await post<{ id: string; version: number }>("/api/material-requests", { ...body, projectId });
      if (submit) await post(`/api/material-requests/${saved.id}/submit`, { version: saved.version });
      navigate(`/material-requests/${saved.id}`);
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };

  return (
    <Page title={id ? "Edit material request" : "New material request"} back={id ? `/material-requests/${id}` : "/material-requests"}>
      <Card>
        <div className="form-grid">
          <Field label="Project">
            <select value={projectId} disabled={!!id} onChange={(e) => { setProjectId(e.target.value); setSiteId(""); }} required>
              {ref.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </Field>
          <Field label="Site / area">
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="">—</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
            </select>
          </Field>
          <Field label="Required on site"><input type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} required /></Field>
          <Field label="Purpose / work description"><input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Level 12 partitions" /></Field>
        </div>
      </Card>
      <Card title="Items" actions={<button className="btn secondary small" onClick={() => setLines((l) => [...l, { itemId: "", qty: "", costCodeId: lines.at(-1)?.costCodeId ?? "", remarks: "" }])}>Add line</button>}>
        <div className="line-editor">
          {lines.map((l, i) => {
            const item = items.find((x) => x.id === l.itemId);
            return (
              <div key={i} className="line-row">
                <span className="line-no">{i + 1}</span>
                <ItemSelect items={items} value={l.itemId} onChange={(v) => setLine(i, { itemId: v })} />
                <Field label={`Qty${item ? ` (${item.baseUnit})` : ""}`}><input inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} required /></Field>
                <Field label="Cost code">
                  <select value={l.costCodeId} onChange={(e) => setLine(i, { costCodeId: e.target.value })} required>
                    <option value="">Select</option>
                    {ref.costCodes.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
                  </select>
                </Field>
                <Field label="Remarks"><input value={l.remarks} onChange={(e) => setLine(i, { remarks: e.target.value })} /></Field>
                {lines.length > 1 && <button className="btn secondary small" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</button>}
              </div>
            );
          })}
        </div>
      </Card>
      <ErrorBox error={err} />
      <div className="actions sticky-actions">
        <button className="btn secondary" disabled={busy} onClick={() => save(false)}>Save draft</button>
        <button className="btn primary" disabled={busy} onClick={() => save(true)}>{busy ? "Saving…" : "Save & submit for approval"}</button>
      </div>
    </Page>
  );
}

export function MrDetail() {
  const { id } = useParams();
  const { me, can } = useApp();
  const navigate = useNavigate();
  const { data: mr, error, loading, reload } = useApi<MrDetailData>(`/api/material-requests/${id}`);
  if (loading && !mr) return <Loading />;
  if (error) return <Page title="Material request" back="/material-requests"><ErrorBox error={error} /></Page>;
  if (!mr) return null;
  const isOwnerOrCreator = can("mr.create");
  const anyUncovered = mr.lines.some((l) => Number(l.fulfilment.uncovered) > 0);
  const anyIssuable = mr.lines.some((l) => Number(l.fulfilment.requested) > Number(l.fulfilment.issued));
  return (
    <Page
      title={<>{mr.number} <Status value={mr.status} />{mr.revision > 0 && <span className="muted small"> revision {mr.revision}</span>}</>}
      subtitle={`${mr.projectCode} — ${mr.projectName}${mr.siteName ? ` · ${mr.siteName}` : ""} · Required ${fmtDate(mr.requiredDate)} · Raised by ${mr.requesterName} on ${fmtDateTime(mr.createdAt)}`}
      back="/material-requests"
      actions={<>
        {mr.status === "draft" && isOwnerOrCreator && <Link className="btn secondary" to={`/material-requests/${mr.id}/edit`}>Edit</Link>}
        {mr.status === "draft" && isOwnerOrCreator && <ActionButton onClick={async () => { await post(`/api/material-requests/${mr.id}/submit`, { version: mr.version }); reload(); }}>Submit for approval</ActionButton>}
        {["rejected", "pending_approval"].includes(mr.status) && isOwnerOrCreator && (
          <ActionButton kind="secondary" confirm="Return this request to draft as a new revision? Any pending approval will be withdrawn." onClick={async () => { await post(`/api/material-requests/${mr.id}/revise`); reload(); }}>Revise</ActionButton>
        )}
        {mr.status === "approved" && anyUncovered && can("po.create") && <Link className="btn primary" to={`/purchase-orders/new?mr=${mr.id}`}>Order shortage</Link>}
        {mr.status === "approved" && anyIssuable && can("stock.issue") && <Link className="btn secondary" to={`/issues/new?mr=${mr.id}`}>Issue stock</Link>}
        {!["cancelled", "closed"].includes(mr.status) && isOwnerOrCreator && (
          <ActionButton kind="danger" onClick={async () => {
            const reason = window.prompt("Reason for cancelling this request?");
            if (!reason) return;
            await post(`/api/material-requests/${mr.id}/cancel`, { reason }); reload();
          }}>Cancel request</ActionButton>
        )}
      </>}
    >
      {mr.purpose && <p>{mr.purpose}</p>}
      {mr.status === "pending_approval" && mr.requestedBy !== me.userId && <DecisionPanel docId={mr.id} onDone={reload} />}
      <Card title="Lines and coverage">
        <div className="table-wrap"><table>
          <thead><tr><th>#</th><th>Item</th><th>Cost code</th><th className="num">Requested</th><th className="num">Issued</th><th className="num">Reserved</th><th className="num">On order</th><th className="num">In transit</th><th className="num">Uncovered</th>{mr.status === "approved" && can("mr.allocate") && <th>Reserve stock</th>}</tr></thead>
          <tbody>{mr.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.lineNo}</td>
              <td><strong>{l.itemCode}</strong><div className="muted small">{l.itemDescription}</div>{l.remarks && <div className="small">{l.remarks}</div>}
                {l.reservations.length > 0 && <div className="small muted">Reservations: {l.reservations.map((r) => `${r.location_code} ${fmtQty(Number(r.qty) - Number(r.qty_consumed))}/${fmtQty(r.qty)} ${r.status}`).join("; ")}</div>}
              </td>
              <td>{l.costCode}</td>
              <td className="num">{fmtQty(l.fulfilment.requested)} {l.baseUnit}</td>
              <td className="num">{fmtQty(l.fulfilment.issued)}</td>
              <td className="num">{fmtQty(l.fulfilment.reserved)}</td>
              <td className="num">{fmtQty(l.fulfilment.onOrder)}</td>
              <td className="num">{fmtQty(l.fulfilment.inTransit)}</td>
              <td className={`num ${Number(l.fulfilment.uncovered) > 0 ? "warn" : ""}`}>{fmtQty(l.fulfilment.uncovered)}</td>
              {mr.status === "approved" && can("mr.allocate") && <td>{Number(l.fulfilment.uncovered) > 0 && <ReserveWidget line={l} projectId={mr.projectId} onDone={reload} />}</td>}
            </tr>))}
          </tbody>
        </table></div>
        <p className="muted small">Uncovered = requested − issued − reserved − on order − in transit. Reserved stock is held for this request and cannot be issued to other work.</p>
      </Card>
      <Card title="Approval history"><ApprovalHistory approvals={mr.approvals} /></Card>
      <History type="material_request" id={mr.id} />
      <div className="muted small">Need to change an approved request? Cancel it (if nothing is ordered or issued) and raise a new one. <button className="linklike" onClick={() => navigate("/material-requests/new")}>New request</button></div>
    </Page>
  );
}

interface StockRow { itemId: string; locationId: string; locationCode: string; locationType: string; free: string; available: string }

function ReserveWidget({ line, projectId, onDone }: { line: MrLine; projectId: string; onDone: () => void }) {
  const { ref } = useApp();
  const { data } = useApi<StockRow[]>(`/api/stock?itemId=${line.itemId}`);
  const options = (data ?? []).filter((s) => Number(s.free) > 0 && (s.locationType === "warehouse" || ref.locations.find((l) => l.id === s.locationId)?.projectId === projectId));
  const [loc, setLoc] = useState("");
  const [qty, setQty] = useState("");
  if (!data) return <span className="muted small">…</span>;
  if (!options.length) return <span className="muted small">No free stock — order it</span>;
  const chosen = options.find((o) => o.locationId === loc);
  return (
    <div className="reserve">
      <select value={loc} onChange={(e) => {
        setLoc(e.target.value);
        const o = options.find((x) => x.locationId === e.target.value);
        if (o) setQty(String(Math.min(Number(o.free), Number(line.fulfilment.uncovered))));
      }} aria-label="Location">
        <option value="">Location…</option>
        {options.map((o) => <option key={o.locationId} value={o.locationId}>{o.locationCode}: {fmtQty(o.free)} free</option>)}
      </select>
      {chosen && <>
        <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Quantity to reserve" />
        <ActionButton onClick={async () => { await post(`/api/material-request-lines/${line.id}/reserve`, { locationId: loc, qty }); onDone(); }}>Reserve</ActionButton>
      </>}
    </div>
  );
}

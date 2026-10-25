import { createContext, useContext, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ApiError } from "./api";
import type { ApprovalRequest, Me, Reference } from "./types";

// ───────────── App context ─────────────
export interface AppCtx {
  me: Me;
  ref: Reference;
  projectId: string | null;
  setProjectId: (id: string | null) => void;
  can: (p: string) => boolean;
}
export const AppContext = createContext<AppCtx | null>(null);
export const useApp = () => useContext(AppContext)!;

// ───────────── Formatting ─────────────
const qtyFmt = new Intl.NumberFormat("en-AE", { maximumFractionDigits: 4 });
const moneyFmt = new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtQty = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "—" : qtyFmt.format(Number(v)));
export const fmtMoney = (v: string | number | null | undefined) => (v === null || v === undefined ? "—" : `AED ${moneyFmt.format(Number(v))}`);
export const fmtDate = (v: string | null | undefined) => (v ? v.slice(0, 10) : "—");
export const fmtDateTime = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("en-GB", { timeZone: "Asia/Dubai", dateStyle: "medium", timeStyle: "short" }) : "—";
export const todayDubai = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ───────────── Building blocks ─────────────
export function Page({ title, subtitle, actions, children, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; back?: string }) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          {back && <Link className="back" to={back}>← Back</Link>}
          <h1>{title}</h1>
          {subtitle && <div className="muted">{subtitle}</div>}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ""}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

const STATUS_TONE: Record<string, string> = {
  draft: "grey", pending_approval: "amber", pending: "amber", waiting: "grey", approved: "green", rejected: "red", cancelled: "grey",
  closed: "grey", superseded: "grey", partially_received: "blue", received: "green", in_transit: "blue", received_with_discrepancy: "red",
  open: "red", written_off: "grey", found: "green", none: "grey", active: "green", consumed: "grey", released: "grey",
};
export function Status({ value }: { value: string }) {
  return <span className={`badge ${STATUS_TONE[value] ?? "grey"}`}>{value.replace(/_/g, " ")}</span>;
}

export function ErrorBox({ error }: { error: ApiError | Error | null | undefined }) {
  if (!error) return null;
  return <div className="error" role="alert">{error.message}</div>;
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return <div className="muted pad">{what}…</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

/** Button that runs an async action, shows progress, and surfaces errors next to itself. */
export function ActionButton({ onClick, children, kind = "primary", confirm, disabled }: {
  onClick: () => Promise<unknown>; children: ReactNode; kind?: "primary" | "secondary" | "danger"; confirm?: string; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  return (
    <span className="action-wrap">
      <button
        className={`btn ${kind}`}
        disabled={busy || disabled}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setBusy(true);
          setErr(null);
          try { await onClick(); } catch (e) { setErr(e as Error); } finally { setBusy(false); }
        }}
      >
        {busy ? "Working…" : children}
      </button>
      {err && <span className="error inline">{err.message}</span>}
    </span>
  );
}

export function ApprovalHistory({ approvals }: { approvals: ApprovalRequest[] }) {
  if (!approvals.length) return <Empty>Not yet submitted for approval.</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Revision</th><th>Step</th><th>Role</th><th>Status</th><th>Decided by</th><th>When</th><th>Comment</th></tr></thead>
        <tbody>
          {approvals.flatMap((a) => a.steps.map((s) => (
            <tr key={s.id} className={a.status === "superseded" ? "dim" : ""}>
              <td>Rev {a.docRevision}{a.status === "superseded" ? " (superseded)" : ""}</td>
              <td>{s.stepNo}</td>
              <td>{s.roleKey.replace(/_/g, " ")}</td>
              <td><Status value={s.status} /></td>
              <td>{s.deciderName ?? "—"}</td>
              <td>{fmtDateTime(s.decidedAt)}</td>
              <td>{s.comment ?? ""}</td>
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}

export function NotTracked({ reason }: { reason: string }) {
  return <span className="not-tracked" title={reason}>Not tracked yet</span>;
}

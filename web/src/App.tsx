import { useEffect, useState, type FormEvent } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { get, post, ApiError } from "./api";
import type { Me, Reference } from "./types";
import { AppContext, ErrorBox, Loading, useApp } from "./ui";
import { Home } from "./pages/Home";
import { MrList, MrDetail, MrForm } from "./pages/MaterialRequests";
import { PoList, PoDetail, PoForm } from "./pages/PurchaseOrders";
import { StockPage, StockCard, IssueForm } from "./pages/Stock";
import { TransferList, TransferForm, TransferDetail } from "./pages/Transfers";
import { ProjectReport } from "./pages/Report";
import { ApprovalsInbox } from "./pages/Approvals";
import { AdminUsers, AuditLog } from "./pages/Admin";
import { Overview } from "./pages/Overview";
import { SubmittalDetail, SubmittalForm, SubmittalList } from "./pages/Submittals";
import { SiteReportDetail, SiteReportForm, SiteReportList } from "./pages/SiteReports";
import { RfiDetail, RfiForm, RfiList } from "./pages/Rfis";
import { DrawingDetail, DrawingForm, DrawingList } from "./pages/Drawings";

/** Owners and managers who look across all projects start on the overview. */
const OVERVIEW_FIRST = ["director", "operations_manager", "management_viewer"];

const PROJECT_KEY = "edge.projectId";

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [ref, setRef] = useState<Reference | null>(null);
  const [projectId, setProjectIdState] = useState<string | null>(() => {
    try { return localStorage.getItem(PROJECT_KEY); } catch { return null; }
  });

  useEffect(() => {
    get<Me>("/api/auth/me").then(setMe).catch(() => setMe(null));
    const onUnauth = () => setMe(null);
    window.addEventListener("edge:unauthenticated", onUnauth);
    return () => window.removeEventListener("edge:unauthenticated", onUnauth);
  }, []);

  useEffect(() => {
    if (!me) return;
    get<Reference>("/api/reference").then((r) => {
      setRef(r);
      // drop a remembered project the user can no longer see
      if (projectId && !r.projects.some((p) => p.id === projectId)) setProjectId(null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const setProjectId = (id: string | null) => {
    setProjectIdState(id);
    try { if (id) localStorage.setItem(PROJECT_KEY, id); else localStorage.removeItem(PROJECT_KEY); } catch { /* storage unavailable */ }
  };

  if (me === undefined) return <Loading />;
  if (me === null) return <Login onLogin={setMe} />;
  if (!ref) return <Loading what="Loading reference data" />;

  const ctx = { me, ref, projectId, setProjectId, can: (p: string) => me.permissions.includes(p) };
  return (
    <AppContext.Provider value={ctx}>
      <Shell onLogout={() => { setMe(null); setRef(null); }}>
        <Routes>
          <Route path="/" element={me.roles.some((r) => OVERVIEW_FIRST.includes(r)) ? <Overview /> : <Home />} />
          <Route path="/today" element={<Home />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/submittals" element={<SubmittalList />} />
          <Route path="/submittals/new" element={<SubmittalForm />} />
          <Route path="/submittals/:id" element={<SubmittalDetail />} />
          <Route path="/submittals/:id/edit" element={<SubmittalForm />} />
          <Route path="/rfis" element={<RfiList />} />
          <Route path="/rfis/new" element={<RfiForm />} />
          <Route path="/rfis/:id" element={<RfiDetail />} />
          <Route path="/rfis/:id/edit" element={<RfiForm />} />
          <Route path="/drawings" element={<DrawingList />} />
          <Route path="/drawings/new" element={<DrawingForm />} />
          <Route path="/drawings/:id" element={<DrawingDetail />} />
          <Route path="/site-reports" element={<SiteReportList />} />
          <Route path="/site-reports/new" element={<SiteReportForm />} />
          <Route path="/site-reports/:id" element={<SiteReportDetail />} />
          <Route path="/site-reports/:id/edit" element={<SiteReportForm />} />
          <Route path="/material-requests" element={<MrList />} />
          <Route path="/material-requests/new" element={<MrForm />} />
          <Route path="/material-requests/:id" element={<MrDetail />} />
          <Route path="/material-requests/:id/edit" element={<MrForm />} />
          <Route path="/purchase-orders" element={<PoList />} />
          <Route path="/purchase-orders/new" element={<PoForm />} />
          <Route path="/purchase-orders/:id" element={<PoDetail />} />
          <Route path="/purchase-orders/:id/edit" element={<PoForm />} />
          <Route path="/stock" element={<StockPage />} />
          <Route path="/stock/card/:itemId" element={<StockCard />} />
          <Route path="/issues/new" element={<IssueForm />} />
          <Route path="/transfers" element={<TransferList />} />
          <Route path="/transfers/new" element={<TransferForm />} />
          <Route path="/transfers/:id" element={<TransferDetail />} />
          <Route path="/report" element={<ProjectReport />} />
          <Route path="/approvals" element={<ApprovalsInbox />} />
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/admin/audit" element={<AuditLog />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </AppContext.Provider>
  );
}

function Shell({ children, onLogout }: { children: React.ReactNode; onLogout: () => void }) {
  const { me, ref, projectId, setProjectId, can } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const overviewFirst = me.roles.some((r) => OVERVIEW_FIRST.includes(r));
  // [path, label, visible, group heading shown before it]
  const links: [string, string, boolean, string?][] = [
    ["/", overviewFirst ? "All projects" : "My day", true],
    [overviewFirst ? "/today" : "/overview", overviewFirst ? "My day" : "All projects", overviewFirst || can("report.view")],
    ["/approvals", "Approvals", can("mr.approve") || can("po.approve")],
    ["/site-reports", "Daily site reports", can("project.view"), "Project control"],
    ["/rfis", "RFIs", can("rfi.view")],
    ["/submittals", "Submittals & mock-ups", can("submittal.view")],
    ["/drawings", "Drawings", can("project.view")],
    ["/material-requests", "Material requests", can("mr.view"), "Materials"],
    ["/purchase-orders", "Purchase orders", can("po.view")],
    ["/stock", "Stock", can("stock.view")],
    ["/transfers", "Transfers", can("stock.view")],
    ["/report", "Materials report", can("report.view")],
    ["/admin/users", "Users", can("admin.users"), "Admin"],
    ["/admin/audit", "Audit trail", can("audit.view")],
  ];
  let lastGroup: string | undefined;
  return (
    <div className="shell">
      <header className="topbar">
        <button className="menu-btn" aria-label="Menu" onClick={() => setMenuOpen((o) => !o)}>☰</button>
        <div className="brand">EDGE <span>SCM</span></div>
        <select className="project-select" aria-label="Project" value={projectId ?? ""} onChange={(e) => setProjectId(e.target.value || null)}>
          <option value="">All my projects</option>
          {ref.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
        </select>
        <div className="user">
          <span className="user-name">{me.fullName}</span>
          <button className="btn secondary small" onClick={async () => { await post("/api/auth/logout"); onLogout(); navigate("/"); }}>Sign out</button>
        </div>
      </header>
      <div className="layout">
        <nav className={`sidenav ${menuOpen ? "open" : ""}`} onClick={() => setMenuOpen(false)}>
          {links.filter((l) => l[2]).map(([to, label, , group]) => {
            const heading = group && group !== lastGroup ? <div className="nav-group">{group}</div> : null;
            if (group) lastGroup = group;
            return <span key={to} className="nav-item">{heading}<NavLink to={to} end={to === "/"}>{label}</NavLink></span>;
          })}
          <div className="nav-foot muted">Roles: {me.roles.join(", ").replace(/_/g, " ")}</div>
        </nav>
        <main>{children}</main>
      </div>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (m: Me) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { onLogin(await post<Me>("/api/auth/login", { email, password })); } catch (x) { setErr(x as ApiError); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <form onSubmit={submit} className="card">
        <div className="brand big">EDGE <span>SCM</span></div>
        <p className="muted">Construction operations — sign in</p>
        <label className="field"><span>Email</span><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="field"><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <ErrorBox error={err} />
        <button className="btn primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}

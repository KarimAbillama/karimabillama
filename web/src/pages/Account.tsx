import { useState, type FormEvent } from "react";
import { post, type ApiError } from "../api";
import { Card, ErrorBox, Field, Page } from "../ui";

/** Change my password. Also shown on its own when the account still has a temporary password. */
export function ChangePassword({ forced, onDone }: { forced?: boolean; onDone?: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [err, setErr] = useState<ApiError | Error | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (next !== again) { setErr(new Error("The two new passwords do not match.")); return; }
    setBusy(true);
    try { await post("/api/auth/password", { currentPassword: current, newPassword: next }); setDone(true); setCurrent(""); setNext(""); setAgain(""); onDone?.(); }
    catch (x) { setErr(x as ApiError); } finally { setBusy(false); }
  };
  return (
    <Page title={forced ? "Set your own password" : "My account"} subtitle={forced ? "You signed in with a temporary password. Choose your own before you continue." : undefined}>
      <Card title="Change password">
        <form onSubmit={submit} className="narrow-form">
          <Field label={forced ? "Temporary password" : "Current password"}><input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></Field>
          <Field label="New password" hint="At least 10 characters. A short sentence is easier to remember."><input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /></Field>
          <Field label="New password again"><input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required /></Field>
          <ErrorBox error={err} />
          {done && !forced && <div className="notice ok">Password changed. Your other devices have been signed out.</div>}
          <div className="actions"><button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Change password"}</button></div>
        </form>
      </Card>
    </Page>
  );
}

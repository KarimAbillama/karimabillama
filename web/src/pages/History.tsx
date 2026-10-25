import { useState } from "react";
import { useApi } from "../api";
import { Card, fmtDateTime } from "../ui";

interface Row { id: number; at: string; action: string; details: Record<string, unknown> | null; userName: string | null }

/** Activity history for one document, from the append-only audit trail. Collapsed by default. */
export function History({ type, id }: { type: string; id: string }) {
  const [open, setOpen] = useState(false);
  const { data } = useApi<Row[]>(open ? `/api/history/${type}/${id}` : null);
  return (
    <Card title="Activity history" actions={<button className="btn secondary small" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Show"}</button>}>
      {open && (
        <ul className="history">
          {(data ?? []).map((r) => (
            <li key={r.id}>
              <span className="muted">{fmtDateTime(r.at)}</span> · <strong>{r.userName ?? "system"}</strong> · {r.action.replace(/[._]/g, " ")}
              {r.details && <span className="muted small"> {Object.entries(r.details).filter(([, v]) => v !== null && typeof v !== "object").map(([k, v]) => `${k}: ${v}`).join(", ")}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

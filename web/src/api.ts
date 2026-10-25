import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "x-edge-csrf": "1", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !url.endsWith("/login")) window.dispatchEvent(new Event("edge:unauthenticated"));
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = data?.error ?? {};
    const details = Array.isArray(e.details) ? e.details.map((d: { path: string; message: string }) => `${d.path}: ${d.message}`).join("; ") : "";
    throw new ApiError(res.status, e.code ?? "ERROR", `${e.message ?? res.statusText}${details ? ` (${details})` : ""}`, e.details);
  }
  return data as T;
}

export const get = <T,>(url: string) => api<T>("GET", url);
export const post = <T,>(url: string, body: unknown = {}) => api<T>("POST", url, body);
export const put = <T,>(url: string, body: unknown) => api<T>("PUT", url, body);

/** Loads data for a page; `reload()` refetches after an action. */
export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!url);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setLoading(true);
    get<T>(url)
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** A stable key per form submission so that a network retry never posts twice. */
export const newIdempotencyKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

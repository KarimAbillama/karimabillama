// Clickable preview: the real web screens (web/src) running against the in-browser stand-in API.
import { StrictMode, useEffect, useReducer, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { App } from "../web/src/App";
import "../web/src/styles.css";
import "./preview.css";
import { DEMO_PASSWORD, handle, seed, signInAs, signedIn } from "./mockServer";

seed();

// Route every /api call to the stand-in. Everything else (none expected) goes to the network.
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = url.startsWith("http") ? new URL(url).pathname + new URL(url).search : url;
  if (!path.startsWith("/api/")) return realFetch(input, init);
  await Promise.resolve();
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  const res = handle((init?.method ?? "GET").toUpperCase(), path, body);
  if (/^\/api\/auth\/(login|logout)/.test(path)) setTimeout(() => window.dispatchEvent(new Event("preview:auth")));
  return new Response(JSON.stringify(res.body), { status: res.status, headers: { "content-type": "application/json" } });
};

// The page frame refuses browser pop-ups, so answer them here: confirmations say yes, and a
// requested reason is filled in so the action can go ahead.
window.confirm = () => true;
window.prompt = (message?: string) => `Demo: ${String(message ?? "").replace(/\?$/, "").slice(0, 60)}`;
window.alert = () => undefined;

// CSV exports are plain links to the server; there is no server here.
document.addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest?.("a[href^='/api/']");
  if (!a) return;
  e.preventDefault();
  toast("CSV exports download a file in the real app. They are turned off in this preview.");
}, true);

function toast(text: string) {
  const el = document.createElement("div");
  el.className = "preview-toast";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

const PEOPLE: [string, string, string][] = [
  ["director@demo.edge.test", "Owner / Director", "all projects at a glance"],
  ["pm.marina@demo.edge.test", "Project manager", "progress, approvals, reviews daily reports"],
  ["engineer.marina@demo.edge.test", "Site engineer", "daily report, material requests, deliveries"],
  ["dc@demo.edge.test", "Document controller", "submittals, samples, mock-ups"],
  ["procurement@demo.edge.test", "Procurement", "orders what is missing"],
  ["stores@demo.edge.test", "Storekeeper", "reserves, issues, transfers"],
  ["ops@demo.edge.test", "Operations manager", "second approval on bigger orders"],
];

// Open signed in, so the first thing on screen is the app itself.
signInAs(PEOPLE[0][0]);

function Preview() {
  const [key, setKey] = useState(0);
  const [who, setWho] = useState<string | null>(PEOPLE[0][0]);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const onAuth = () => { if (!signedIn()) setWho(null); refresh(); };
    window.addEventListener("preview:auth", onAuth);
    return () => window.removeEventListener("preview:auth", onAuth);
  }, []);
  const switchTo = (email: string) => { signInAs(email); setWho(email); setKey((k) => k + 1); };
  return (
    <>
      <div className="preview-bar">
        <div className="preview-note"><strong>Clickable preview.</strong> Invented demo data. Switch person with the buttons; changes stay until you reload this page.</div>
        <div className="preview-people" role="group" aria-label="Sign in as">
          <span className="preview-label">Sign in as:</span>
          {PEOPLE.map(([email, role, hint]) => (
            <button key={email} type="button" title={hint} className={who === email && signedIn() ? "on" : ""} onClick={() => switchTo(email)}>{role}</button>
          ))}
        </div>
      </div>
      {!signedIn() && (
        <div className="preview-start">
          Pick a person above, or sign in below with any demo email and the password <code>{DEMO_PASSWORD}</code>.
        </div>
      )}
      <MemoryRouter key={key}>
        <App />
      </MemoryRouter>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Preview /></StrictMode>);

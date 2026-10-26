import { readFileSync } from "node:fs";

export function loadConfig() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and adjust it.");
  // HTTPS: either a .pfx/.p12 file (usual on Windows) or a PEM certificate + key.
  const pfx = process.env.TLS_PFX_FILE;
  const cert = process.env.TLS_CERT_FILE;
  const key = process.env.TLS_KEY_FILE;
  const https = pfx
    ? { pfx: readFileSync(pfx), passphrase: process.env.TLS_PFX_PASSPHRASE || undefined }
    : cert && key ? { cert: readFileSync(cert), key: readFileSync(key) } : null;
  const production = process.env.NODE_ENV === "production";
  return {
    databaseUrl,
    port: Number(process.env.PORT ?? (https ? 443 : 3001)),
    host: process.env.HOST ?? (production ? "0.0.0.0" : "127.0.0.1"),
    sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 12),
    // Secure cookies whenever we serve HTTPS ourselves or the operator says a proxy does.
    cookieSecure: process.env.COOKIE_SECURE === "true" || !!https,
    production,
    https,
    webDir: process.env.WEB_DIR || undefined,
  };
}

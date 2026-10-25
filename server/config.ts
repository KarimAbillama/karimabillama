export function loadConfig() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and adjust it.");
  return {
    databaseUrl,
    port: Number(process.env.PORT ?? 3001),
    sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 12),
    cookieSecure: process.env.COOKIE_SECURE === "true",
    production: process.env.NODE_ENV === "production",
  };
}

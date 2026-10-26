import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import type { DB } from "./db/client.js";
import { type Actor, loadActor } from "./auth/actor.js";
import { changePassword, login, logout, resolveSession } from "./auth/sessions.js";
import { AppError, pgCode } from "./lib/errors.js";
import { registerRoutes } from "./routes.js";
import { audit } from "./lib/audit.js";

export interface AppConfig {
  sessionTtlHours: number;
  cookieSecure: boolean;
  logger?: boolean;
  serveWeb?: boolean;
  /** Folder with the built web app (default: dist/web). */
  webDir?: string;
  /** Serve HTTPS directly (Windows Server install) instead of behind a proxy. */
  https?: { pfx?: Buffer; passphrase?: string; cert?: Buffer; key?: Buffer };
  /** Login attempts allowed per IP per minute (default 10). */
  loginRateLimit?: number;
}

declare module "fastify" {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

export const SESSION_COOKIE = "edge_session";
export const CSRF_HEADER = "x-edge-csrf";

export async function buildApp(db: DB, config: AppConfig) {
  const app = Fastify({
    ...(config.https ? { https: config.https } : {}),
    logger: config.logger ? { redact: ["req.headers.cookie", "req.headers.authorization", "res.headers['set-cookie']"] } : false,
    bodyLimit: 1_000_000,
    trustProxy: true,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.decorateRequest("actor", null);

  // Authentication + CSRF guard for every /api route except login/health.
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers[CSRF_HEADER] !== "1") {
      // Browsers cannot send this custom header cross-site without a CORS preflight, which we never allow.
      return reply.code(403).send({ error: { code: "CSRF", message: "Missing request header" } });
    }
    if (req.url === "/api/auth/login" || req.url === "/api/health") return;
    const token = req.cookies[SESSION_COOKIE];
    const userId = token ? await resolveSession(db, token) : null;
    const actor = userId ? await loadActor(db, userId) : null;
    if (!actor) return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Please sign in" } });
    actor.ip = req.ip;
    req.actor = actor;
    // Accounts on a temporary password can only change it (or sign out) until they do.
    const path = req.url.split("?")[0];
    if (actor.mustChangePassword && !["/api/auth/me", "/api/auth/password", "/api/auth/logout"].includes(path)) {
      return reply.code(403).send({ error: { code: "PASSWORD_CHANGE_REQUIRED", message: "Set your own password first." } });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION", message: "Some fields are missing or invalid.", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } });
    }
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: { code: "REQUEST", message: e.message } });
    if (pgCode(err) === "40P01" || pgCode(err) === "40001") {
      return reply.code(409).send({ error: { code: "RETRY", message: "Another user was updating the same records. Please try again." } });
    }
    req.log?.error(err);
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Something went wrong. The error has been logged." } });
  });

  app.get("/api/health", async () => ({ ok: true }));

  app.post("/api/auth/login", { config: { rateLimit: { max: config.loginRateLimit ?? 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string; password?: string };
    if (!body.email || !body.password) return reply.code(400).send({ error: { code: "VALIDATION", message: "Email and password are required." } });
    const res = await login(db, body.email, body.password, config.sessionTtlHours, { ip: req.ip, ua: req.headers["user-agent"] });
    if (!res.ok) {
      const message = res.reason === "locked" ? "Too many failed attempts. Try again in 15 minutes." : "Email or password is incorrect.";
      return reply.code(401).send({ error: { code: res.reason === "locked" ? "LOCKED" : "INVALID_LOGIN", message } });
    }
    reply.setCookie(SESSION_COOKIE, res.token, {
      httpOnly: true, sameSite: "lax", secure: config.cookieSecure, path: "/", maxAge: config.sessionTtlHours * 3600,
    });
    const actor = await loadActor(db, res.userId);
    return meResponse(actor!);
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await logout(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => meResponse(req.actor!));

  app.post("/api/auth/password", { config: { rateLimit: { max: config.loginRateLimit ?? 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = (req.body ?? {}) as { currentPassword?: string; newPassword?: string };
    if (!body.currentPassword || !body.newPassword) return reply.code(400).send({ error: { code: "VALIDATION", message: "Enter your current and new password." } });
    const res = await changePassword(db, req.actor!.userId, req.cookies[SESSION_COOKIE]!, body.currentPassword, body.newPassword);
    if (!res.ok) return reply.code(422).send({ error: { code: "PASSWORD", message: res.message } });
    await audit(db, req.actor!, "auth.password_changed", "user", req.actor!.userId, null);
    return { ok: true };
  });

  await registerRoutes(app, db);

  if (config.serveWeb) {
    const webDir = config.webDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/web");
    if (existsSync(webDir)) {
      await app.register(fastifyStatic, { root: webDir, wildcard: false });
      app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
        if (req.url.startsWith("/api/")) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Not found" } });
        return reply.sendFile("index.html");
      });
    }
  }
  return app;
}

function meResponse(a: Actor) {
  return { userId: a.userId, email: a.email, fullName: a.fullName, roles: a.roleKeys, permissions: [...a.permissions].sort(), allProjects: a.allProjects, mustChangePassword: a.mustChangePassword };
}

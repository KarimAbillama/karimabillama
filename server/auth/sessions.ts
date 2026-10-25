import { createHash, randomBytes } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { and, eq, gt, lt } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { sessions, users } from "../db/schema.js";

// Password hashing uses Argon2id via a maintained library; no custom cryptography.
export const hashPassword = (pw: string) => argonHash(pw);
export const verifyPassword = (hash: string, pw: string) => argonVerify(hash, pw).catch(() => false);

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= argonHash("timing-equaliser-not-a-password"));

export type LoginResult = { ok: true; token: string; userId: string } | { ok: false; reason: "invalid" | "locked" };

export async function login(db: DB, email: string, password: string, ttlHours: number, meta: { ip?: string; ua?: string }): Promise<LoginResult> {
  const [u] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  if (!u || !u.isActive) {
    await verifyPassword(await getDummyHash(), password); // keep response time similar for unknown emails
    return { ok: false, reason: "invalid" };
  }
  if (u.lockedUntil && u.lockedUntil > new Date()) return { ok: false, reason: "locked" };
  if (!(await verifyPassword(u.passwordHash, password))) {
    const failed = u.failedLoginCount + 1;
    await db.update(users).set({
      failedLoginCount: failed >= MAX_FAILED ? 0 : failed,
      lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
    }).where(eq(users.id, u.id));
    return { ok: false, reason: "invalid" };
  }
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    tokenHash: sha256(token),
    userId: u.id,
    expiresAt: new Date(Date.now() + ttlHours * 3_600_000),
    ip: meta.ip,
    userAgent: meta.ua?.slice(0, 300),
  });
  await db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, u.id));
  return { ok: true, token, userId: u.id };
}

export async function resolveSession(db: DB, token: string): Promise<string | null> {
  const [s] = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())));
  return s?.userId ?? null;
}

export async function logout(db: DB, token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

export async function purgeExpiredSessions(db: DB) {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

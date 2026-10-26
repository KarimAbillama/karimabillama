import { and, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "../db/client.js";
import { locations, projectMembers, rolePermissions, roles, userRoles, users } from "../db/schema.js";
import { forbidden, notFound } from "../lib/errors.js";
import type { Permission } from "./permissions.js";

/** The signed-in user and everything needed to make authorisation decisions on the server. */
export interface Actor {
  userId: string;
  email: string;
  fullName: string;
  roleKeys: string[];
  permissions: Set<string>;
  allProjects: boolean;
  projectIds: string[];
  mustChangePassword: boolean;
  ip?: string;
}

export async function loadActor(db: DbOrTx, userId: string): Promise<Actor | null> {
  const [u] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.isActive, true)));
  if (!u) return null;
  const rs = await db
    .select({ id: roles.id, key: roles.key, allProjects: roles.allProjects })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
  const perms = rs.length
    ? await db.select({ p: rolePermissions.permission }).from(rolePermissions).where(inArray(rolePermissions.roleId, rs.map((r) => r.id)))
    : [];
  const memberships = await db.select({ projectId: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, userId));
  return {
    userId: u.id,
    email: u.email,
    fullName: u.fullName,
    roleKeys: rs.map((r) => r.key),
    permissions: new Set(perms.map((p) => p.p)),
    allProjects: rs.some((r) => r.allProjects),
    projectIds: memberships.map((m) => m.projectId),
    mustChangePassword: u.mustChangePassword,
  };
}

export const can = (a: Actor, p: Permission) => a.permissions.has(p);

export function requirePerm(a: Actor, ...ps: Permission[]) {
  for (const p of ps) if (!a.permissions.has(p)) throw forbidden(`Missing permission: ${p}`);
}

export const canAccessProject = (a: Actor, projectId: string) => a.allProjects || a.projectIds.includes(projectId);

/** Out-of-scope projects are reported as "not found" so their existence is not disclosed. */
export function requireProject(a: Actor, projectId: string | null | undefined, what = "Record") {
  if (!projectId || !canAccessProject(a, projectId)) throw notFound(what);
}

/** null = no restriction (company-wide role); otherwise the list of project ids the actor may see. */
export const projectScope = (a: Actor): string[] | null => (a.allProjects ? null : a.projectIds);

/**
 * Location access: project site stores follow project access; central warehouses and the transit
 * location require stock.view.
 */
export async function requireLocation(db: DbOrTx, a: Actor, locationId: string) {
  const [loc] = await db.select().from(locations).where(eq(locations.id, locationId));
  if (!loc) throw notFound("Location");
  if (loc.projectId) {
    if (!canAccessProject(a, loc.projectId)) throw notFound("Location");
  } else if (!a.permissions.has("stock.view")) {
    throw notFound("Location");
  }
  return loc;
}

export async function canAccessLocation(db: DbOrTx, a: Actor, locationId: string) {
  try {
    await requireLocation(db, a, locationId);
    return true;
  } catch {
    return false;
  }
}

export function requireRole(a: Actor, roleKey: string) {
  if (!a.roleKeys.includes(roleKey)) throw forbidden(`This approval step requires the role "${roleKey}"`);
}

import { and, asc, eq, gt, lt, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { ConflictError } from "./repository.js";
import { auditLogs, memberships, organizations, sessions, users } from "./schema.js";

export type Role = "ADMIN" | "CONSULTANT" | "AUDITOR";

const isUniqueViolation = (e: unknown): boolean => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
};

/** Alta de usuario con su propia organización (rol ADMIN). El email debe venir en minúsculas. */
export async function registerUserWithOrganization(
  db: Db,
  input: { email: string; name?: string; passwordHash: string; organizationName: string },
) {
  try {
    return await db.transaction(async (tx) => {
      const [org] = await tx.insert(organizations).values({ name: input.organizationName }).returning();
      const [user] = await tx
        .insert(users)
        .values({ email: input.email, name: input.name ?? null, passwordHash: input.passwordHash })
        .returning();
      if (!org || !user) throw new Error("No se pudo crear el usuario");
      await tx.insert(memberships).values({ userId: user.id, organizationId: org.id, role: "ADMIN" });
      await tx
        .insert(auditLogs)
        .values({ organizationId: org.id, actorId: user.id, action: "user.register", entity: "user", entityId: user.id });
      return { user, organization: org, role: "ADMIN" as Role };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("El email ya está registrado");
    throw e;
  }
}

export async function findUserByEmail(db: Db, email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user ?? null;
}

export async function getUserById(db: Db, id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user ?? null;
}

/** Suma un intento fallido y bloquea la cuenta al llegar al máximo. */
export async function registerFailedLogin(db: Db, userId: string, maxAttempts: number, lockMinutes: number) {
  await db
    .update(users)
    .set({
      failedLoginAttempts: sql`${users.failedLoginAttempts} + 1`,
      lockedUntil: sql`case when ${users.failedLoginAttempts} + 1 >= ${maxAttempts}
        then now() + make_interval(mins => ${lockMinutes}) else ${users.lockedUntil} end`,
    })
    .where(eq(users.id, userId));
}

export async function clearLoginFailures(db: Db, userId: string) {
  await db.update(users).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(users.id, userId));
}

/** Organización por defecto del usuario: la primera a la que se unió. */
export async function getPrimaryMembership(db: Db, userId: string) {
  const [row] = await db
    .select({
      organizationId: memberships.organizationId,
      role: memberships.role,
      organizationName: organizations.name,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(organizations.createdAt))
    .limit(1);
  return row ?? null;
}

export async function createSession(
  db: Db,
  input: { userId: string; organizationId: string; tokenHash: string; expiresAt: Date },
) {
  const [row] = await db.insert(sessions).values(input).returning();
  if (!row) throw new Error("No se pudo crear la sesión");
  return row;
}

/** Sesión vigente + rol actual. Si quitaron al usuario de la organización, deja de ser válida. */
export async function findActiveSession(db: Db, tokenHash: string) {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      organizationId: sessions.organizationId,
      role: memberships.role,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(
      memberships,
      and(eq(memberships.userId, sessions.userId), eq(memberships.organizationId, sessions.organizationId)),
    )
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, sql`now()`)));
  return row ?? null;
}

export async function deleteSession(db: Db, tokenHash: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

export async function deleteSessionsForUser(db: Db, userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function deleteExpiredSessions(db: Db) {
  await db.delete(sessions).where(lt(sessions.expiresAt, sql`now()`));
}

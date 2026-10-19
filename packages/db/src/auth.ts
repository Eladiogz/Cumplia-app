import { and, asc, desc, eq, gt, lt, ne, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { ConflictError, setTenantContext } from "./repository.js";
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
      await setTenantContext(tx, org.id); // la auditoría está protegida por RLS
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

/**
 * Suma un intento fallido y bloquea la cuenta al llegar al máximo. Se llama solo
 * con la cuenta desbloqueada, así que `true` significa "se bloqueó con este intento".
 */
export async function registerFailedLogin(db: Db, userId: string, maxAttempts: number, lockMinutes: number) {
  const [row] = await db
    .update(users)
    .set({
      failedLoginAttempts: sql`${users.failedLoginAttempts} + 1`,
      lockedUntil: sql`case when ${users.failedLoginAttempts} + 1 >= ${maxAttempts}
        then now() + make_interval(mins => ${lockMinutes}) else ${users.lockedUntil} end`,
    })
    .where(eq(users.id, userId))
    .returning({ attempts: users.failedLoginAttempts });
  return (row?.attempts ?? 0) >= maxAttempts;
}

export async function clearLoginFailures(db: Db, userId: string) {
  await db.update(users).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(users.id, userId));
}

/**
 * Organización con la que inicia sesión el usuario: la de su última sesión si
 * sigue siendo miembro; si no, la primera a la que se unió.
 */
export async function getLoginMembership(db: Db, userId: string) {
  const [row] = await db
    .select({
      organizationId: memberships.organizationId,
      role: memberships.role,
      organizationName: organizations.name,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.userId, userId))
    .orderBy(
      desc(sql`${memberships.organizationId} is not distinct from ${users.lastOrganizationId}`),
      asc(organizations.createdAt),
    )
    .limit(1);
  return row ?? null;
}

/** Crea la sesión y recuerda su organización para el próximo inicio de sesión. */
export async function createSession(
  db: Db,
  input: {
    userId: string;
    organizationId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ipAddress?: string | null;
  },
) {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(sessions).values(input).returning();
    if (!row) throw new Error("No se pudo crear la sesión");
    await tx.update(users).set({ lastOrganizationId: input.organizationId }).where(eq(users.id, input.userId));
    return row;
  });
}

/**
 * Horas sin actividad tras las que una sesión deja de valer, aunque no haya llegado a
 * su vencimiento (7 días): una computadora compartida u olvidada no queda abierta.
 */
export const SESSION_IDLE_HOURS = 12;

/**
 * Sesión vigente + rol actual (se lee en cada petición: un cambio de rol rige al instante).
 * Si quitaron al usuario de la organización, o pasó SESSION_IDLE_HOURS sin uso, deja de ser válida.
 */
export async function findActiveSession(db: Db, tokenHash: string) {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      organizationId: sessions.organizationId,
      role: memberships.role,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      userMfaEnabled: sql<boolean>`${users.mfaEnabledAt} is not null`,
      userEmailVerified: sql<boolean>`${users.emailVerifiedAt} is not null`,
      organizationRequiresMfa: organizations.requireMfa,
    })
    .from(sessions)
    .innerJoin(
      memberships,
      and(eq(memberships.userId, sessions.userId), eq(memberships.organizationId, sessions.organizationId)),
    )
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(organizations, eq(organizations.id, sessions.organizationId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        gt(sessions.expiresAt, sql`now()`),
        gt(sessions.lastSeenAt, sql`now() - make_interval(hours => ${SESSION_IDLE_HOURS})`),
      ),
    );
  return row ?? null;
}

/** Minutos entre actualizaciones de la última actividad: evita una escritura por petición. */
export const SESSION_ACTIVITY_MINUTES = 5;

/**
 * Registra actividad de la sesión si la última es más vieja que SESSION_ACTIVITY_MINUTES.
 * Condicional en la base: peticiones simultáneas no escriben de más.
 */
export async function touchSession(db: Db, session: { sessionId: string; lastSeenAt: Date }, now = new Date()) {
  if (now.getTime() - session.lastSeenAt.getTime() < SESSION_ACTIVITY_MINUTES * 60_000) return;
  await db
    .update(sessions)
    .set({ lastSeenAt: sql`now()` })
    .where(
      and(
        eq(sessions.id, session.sessionId),
        lt(sessions.lastSeenAt, sql`now() - make_interval(mins => ${SESSION_ACTIVITY_MINUTES})`),
      ),
    );
}

/**
 * Sesiones vigentes de la cuenta, en todas sus organizaciones (la persona solo ve
 * las propias). Nunca devuelve el hash del token.
 */
export async function listSessionsForUser(db: Db, userId: string) {
  return db
    .select({
      id: sessions.id,
      organizationId: sessions.organizationId,
      organizationName: organizations.name,
      userAgent: sessions.userAgent,
      ipAddress: sessions.ipAddress,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(organizations, eq(organizations.id, sessions.organizationId))
    .where(
      and(
        eq(sessions.userId, userId),
        gt(sessions.expiresAt, sql`now()`),
        gt(sessions.lastSeenAt, sql`now() - make_interval(hours => ${SESSION_IDLE_HOURS})`),
      ),
    )
    .orderBy(desc(sessions.lastSeenAt));
}

/** Cierra UNA sesión de la cuenta. Devuelve su organización, o null si no era suya o no existe. */
export async function deleteSessionOfUser(db: Db, userId: string, sessionId: string) {
  const [row] = await db
    .delete(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .returning({ organizationId: sessions.organizationId });
  return row ?? null;
}

export async function deleteSession(db: Db, tokenHash: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

export async function deleteSessionsForUser(db: Db, userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Cierra todas las sesiones del usuario salvo la indicada (p. ej. al activar MFA). Devuelve cuántas cerró. */
export async function deleteOtherSessionsForUser(db: Db, userId: string, keepTokenHash: string) {
  const closed = await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.tokenHash, keepTokenHash)))
    .returning({ id: sessions.id });
  return closed.length;
}

export async function deleteExpiredSessions(db: Db) {
  await db.delete(sessions).where(lt(sessions.expiresAt, sql`now()`));
}

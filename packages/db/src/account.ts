import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { forOrganization } from "./repository.js";
import { memberships, mfaChallenges, sessions, userTokens, users, type AuditDetails } from "./schema.js";

export type UserTokenPurpose = "password_reset" | "email_verification";

/**
 * Emite un token nuevo para la cuenta. Los anteriores del mismo tipo que no se
 * usaron dejan de servir: solo vale el último link enviado.
 */
export async function issueUserToken(
  db: Db,
  input: { userId: string; purpose: UserTokenPurpose; tokenHash: string; expiresAt: Date; createdBy?: string | null },
) {
  await db.transaction(async (tx) => {
    await tx
      .update(userTokens)
      .set({ usedAt: sql`now()` })
      .where(and(eq(userTokens.userId, input.userId), eq(userTokens.purpose, input.purpose), isNull(userTokens.usedAt)));
    await tx.insert(userTokens).values({ ...input, createdBy: input.createdBy ?? null });
  });
}

/** ¿Se emitió un token de este tipo hace menos de `seconds`? (para no inundar la casilla). */
export async function issuedRecently(db: Db, userId: string, purpose: UserTokenPurpose, seconds: number) {
  const [row] = await db
    .select({ id: userTokens.id })
    .from(userTokens)
    .where(
      and(
        eq(userTokens.userId, userId),
        eq(userTokens.purpose, purpose),
        gt(userTokens.createdAt, sql`now() - make_interval(secs => ${seconds})`),
      ),
    )
    .orderBy(desc(userTokens.createdAt))
    .limit(1);
  return row !== undefined;
}

/** Cuenta del token si sigue vigente y sin usar, SIN gastarlo (para validar antes de canjear). */
export async function peekUserToken(db: Db, tokenHash: string, purpose: UserTokenPurpose) {
  const [row] = await db
    .select({ userId: userTokens.userId })
    .from(userTokens)
    .where(
      and(
        eq(userTokens.tokenHash, tokenHash),
        eq(userTokens.purpose, purpose),
        isNull(userTokens.usedAt),
        gt(userTokens.expiresAt, sql`now()`),
      ),
    );
  return row ?? null;
}

/** Gasta el token de forma atómica (una sola vez, vigente). Devuelve la cuenta o null. */
export async function consumeUserToken(db: Db, tokenHash: string, purpose: UserTokenPurpose) {
  const [row] = await db
    .update(userTokens)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(userTokens.tokenHash, tokenHash),
        eq(userTokens.purpose, purpose),
        isNull(userTokens.usedAt),
        gt(userTokens.expiresAt, sql`now()`),
      ),
    )
    .returning({ userId: userTokens.userId, createdBy: userTokens.createdBy });
  return row ?? null;
}

/**
 * Cambia la contraseña: desbloquea la cuenta y cierra las sesiones (todas, o todas
 * menos la actual si la cambió la propia persona estando dentro).
 */
export async function setPassword(db: Db, userId: string, passwordHash: string, keepSessionTokenHash?: string) {
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash, failedLoginAttempts: 0, lockedUntil: null }).where(eq(users.id, userId));
    await tx
      .delete(sessions)
      .where(
        keepSessionTokenHash
          ? and(eq(sessions.userId, userId), ne(sessions.tokenHash, keepSessionTokenHash))
          : eq(sessions.userId, userId),
      );
    await tx.delete(mfaChallenges).where(eq(mfaChallenges.userId, userId));
  });
}

export async function markEmailVerified(db: Db, userId: string) {
  await db
    .update(users)
    .set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` })
    .where(eq(users.id, userId));
}

/** Cierra las sesiones (y desafíos MFA) de la cuenta en TODAS sus organizaciones. */
export async function deleteAllSessionsForUser(db: Db, userId: string) {
  await db.transaction(async (tx) => {
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(mfaChallenges).where(eq(mfaChallenges.userId, userId));
  });
}

/**
 * Registra un evento de la CUENTA (p. ej. cambio de contraseña) en la auditoría de
 * cada organización a la que pertenece: a todas les importa.
 */
export async function recordForAllMemberships(db: Db, userId: string, action: string, details?: AuditDetails) {
  const orgs = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(eq(memberships.userId, userId));
  for (const { organizationId } of orgs) {
    await forOrganization(db, organizationId, userId).record(action, "user", userId, details);
  }
}

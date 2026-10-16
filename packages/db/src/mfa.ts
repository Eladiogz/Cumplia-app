import { and, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { mfaChallenges, mfaRecoveryCodes, users } from "./schema.js";

/** Guarda un secreto nuevo sin activar. Falla (false) si el usuario ya tiene MFA activo. */
export async function setPendingMfaSecret(db: Db, userId: string, encryptedSecret: string) {
  const rows = await db
    .update(users)
    .set({ mfaSecret: encryptedSecret, mfaLastUsedStep: null })
    .where(and(eq(users.id, userId), isNull(users.mfaEnabledAt)))
    .returning({ id: users.id });
  return rows.length > 0;
}

/** Activa MFA y reemplaza los códigos de recuperación. Solo si había un secreto pendiente. */
export async function enableMfa(db: Db, userId: string, usedStep: number, recoveryCodeHashes: string[]) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(users)
      .set({ mfaEnabledAt: sql`now()`, mfaLastUsedStep: usedStep })
      .where(and(eq(users.id, userId), isNull(users.mfaEnabledAt), isNotNull(users.mfaSecret)))
      .returning({ id: users.id });
    if (rows.length === 0) return false;
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
    await tx.insert(mfaRecoveryCodes).values(recoveryCodeHashes.map((codeHash) => ({ userId, codeHash })));
    return true;
  });
}

/** Reemplaza todos los códigos de recuperación (los anteriores dejan de servir). */
export async function replaceRecoveryCodes(db: Db, userId: string, recoveryCodeHashes: string[]) {
  await db.transaction(async (tx) => {
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
    await tx.insert(mfaRecoveryCodes).values(recoveryCodeHashes.map((codeHash) => ({ userId, codeHash })));
  });
}

export async function disableMfa(db: Db, userId: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ mfaSecret: null, mfaEnabledAt: null, mfaLastUsedStep: null })
      .where(eq(users.id, userId));
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
    await tx.delete(mfaChallenges).where(eq(mfaChallenges.userId, userId));
  });
}

/**
 * Marca un paso TOTP como usado de forma atómica. Devuelve false si ya se usó
 * ese paso u otro posterior (código repetido o interceptado).
 */
export async function consumeTotpStep(db: Db, userId: string, step: number) {
  const rows = await db
    .update(users)
    .set({ mfaLastUsedStep: step })
    .where(and(eq(users.id, userId), or(isNull(users.mfaLastUsedStep), lt(users.mfaLastUsedStep, step))))
    .returning({ id: users.id });
  return rows.length > 0;
}

/** Gasta un código de recuperación (una sola vez). */
export async function consumeRecoveryCode(db: Db, userId: string, codeHash: string) {
  const rows = await db
    .update(mfaRecoveryCodes)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(mfaRecoveryCodes.userId, userId),
        eq(mfaRecoveryCodes.codeHash, codeHash),
        isNull(mfaRecoveryCodes.usedAt),
      ),
    )
    .returning({ id: mfaRecoveryCodes.id });
  return rows.length > 0;
}

export async function countUnusedRecoveryCodes(db: Db, userId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(mfaRecoveryCodes)
    .where(and(eq(mfaRecoveryCodes.userId, userId), isNull(mfaRecoveryCodes.usedAt)));
  return row?.n ?? 0;
}

export async function createMfaChallenge(
  db: Db,
  input: { userId: string; organizationId: string; tokenHash: string; expiresAt: Date },
) {
  const [row] = await db.insert(mfaChallenges).values(input).returning();
  if (!row) throw new Error("No se pudo crear el desafío MFA");
  return row;
}

export async function findMfaChallenge(db: Db, tokenHash: string) {
  const [row] = await db
    .select()
    .from(mfaChallenges)
    .where(and(eq(mfaChallenges.tokenHash, tokenHash), gt(mfaChallenges.expiresAt, sql`now()`)));
  return row ?? null;
}

/** Suma un intento fallido al desafío y lo elimina al llegar al máximo. */
export async function registerFailedMfaChallenge(db: Db, challengeId: string, maxAttempts: number) {
  const [row] = await db
    .update(mfaChallenges)
    .set({ attempts: sql`${mfaChallenges.attempts} + 1` })
    .where(eq(mfaChallenges.id, challengeId))
    .returning({ attempts: mfaChallenges.attempts });
  if (row && row.attempts >= maxAttempts) await deleteMfaChallenge(db, challengeId);
}

export async function deleteMfaChallenge(db: Db, challengeId: string) {
  await db.delete(mfaChallenges).where(eq(mfaChallenges.id, challengeId));
}

export async function deleteExpiredMfaChallenges(db: Db) {
  await db.delete(mfaChallenges).where(lt(mfaChallenges.expiresAt, sql`now()`));
}

import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { consumeRecoveryCode, consumeTotpStep, type Db, type getUserById } from "@cumplia/db";
import { PASSWORD_MAX_LENGTH } from "@cumplia/core/password";
import type { Mailer } from "../email/mailer.js";
import { decrypt } from "./encryption.js";
import { failedAttempt } from "./lockout.js";
import { verifyPassword } from "./password.js";
import { hashRecoveryCode, verifyTotp } from "./totp.js";

export type User = NonNullable<Awaited<ReturnType<typeof getUserById>>>;

export const SecondFactorFields = {
  code: z.string().trim().regex(/^\d{6}$/, "Código de 6 dígitos").optional(),
  recoveryCode: z.string().trim().min(10).max(32).optional(),
};

/** Contraseña y, si la cuenta tiene MFA, un código (de la app o de recuperación). */
export const ReauthBody = z.object({ password: z.string().min(1).max(PASSWORD_MAX_LENGTH), ...SecondFactorFields });
export type Reauth = z.infer<typeof ReauthBody>;

export const isLocked = (user: User) => (user.lockedUntil ? user.lockedUntil.getTime() > Date.now() : false);

/** Verifica un código TOTP (sin reutilizar pasos) o gasta un código de recuperación. */
export async function checkSecondFactor(
  db: Db,
  encryptionKey: Buffer | undefined,
  user: User,
  input: { code?: string; recoveryCode?: string },
) {
  if (input.code !== undefined) {
    if (!user.mfaSecret || !encryptionKey) return null;
    const step = verifyTotp(decrypt(encryptionKey, user.mfaSecret, `mfa:${user.id}`), input.code);
    return step !== null && (await consumeTotpStep(db, user.id, step)) ? ("totp" as const) : null;
  }
  if (input.recoveryCode !== undefined) {
    return (await consumeRecoveryCode(db, user.id, hashRecoveryCode(input.recoveryCode))) ? ("recovery" as const) : null;
  }
  return null;
}

/**
 * Confirma que quien pide una acción irreversible (eliminar la cuenta o la
 * organización) es la dueña de la cuenta y no alguien con una sesión robada.
 * Cada fallo cuenta para el bloqueo de la cuenta, como en el inicio de sesión.
 */
export async function confirmIdentity(
  { db, mailer, log, encryptionKey }: { db: Db; mailer: Mailer; log: FastifyBaseLogger; encryptionKey?: Buffer },
  user: User,
  input: Reauth,
) {
  if (isLocked(user)) return false;
  const passwordOk = !!user.passwordHash && (await verifyPassword(input.password, user.passwordHash));
  const secondOk = !user.mfaEnabledAt || (passwordOk && (await checkSecondFactor(db, encryptionKey, user, input)) !== null);
  if (passwordOk && secondOk) return true;
  await failedAttempt(db, { mailer, log }, user);
  return false;
}

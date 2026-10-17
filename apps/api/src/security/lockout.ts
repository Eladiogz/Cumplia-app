import type { FastifyBaseLogger } from "fastify";
import { registerFailedLogin, type Db } from "@cumplia/db";
import { notify, type Mailer } from "../email/mailer.js";
import { accountLockedEmail } from "../email/templates.js";

/** Intentos fallidos (contraseña o MFA) antes de bloquear la cuenta, y por cuánto. */
export const MAX_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

/**
 * Registra un intento fallido y, si con él se bloqueó la cuenta, avisa por email
 * (en segundo plano: la respuesta tarda lo mismo, no revela que la cuenta existe).
 */
export async function failedAttempt(
  db: Db,
  { mailer, log }: { mailer: Mailer; log: FastifyBaseLogger },
  user: { id: string; email: string },
) {
  if (await registerFailedLogin(db, user.id, MAX_ATTEMPTS, LOCK_MINUTES)) {
    notify(mailer, log, accountLockedEmail(user.email, LOCK_MINUTES));
  }
}

import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import {
  consumeUserToken,
  findUserByEmail,
  getUserById,
  issueUserToken,
  issuedRecently,
  listMembershipsForUser,
  markEmailVerified,
  peekUserToken,
  recordForAllMemberships,
  setPassword,
  type Db,
} from "@cumplia/db";
import { PASSWORD_MAX_LENGTH } from "@cumplia/core/password";
import { PASSWORD_RESET_PATH, VERIFY_EMAIL_PATH, appLink } from "../email/links.js";
import { notify, type Mailer } from "../email/mailer.js";
import { passwordChangedEmail, passwordResetEmail, verifyEmailEmail } from "../email/templates.js";
import { failedAttempt } from "../security/lockout.js";
import { hashPassword, verifyPassword } from "../security/password.js";
import { assertStrongPassword } from "../security/password-policy.js";
import { currentSession, hashToken, newSessionToken } from "../security/session.js";
import { Email, NewPassword } from "./schemas.js";

export const PASSWORD_RESET_MINUTES = 30;
export const EMAIL_VERIFICATION_HOURS = 24;
/** Un mismo tipo de email no se reenvía antes de este tiempo (evita inundar la casilla). */
const RESEND_SECONDS = 60;

const Token = z.string().trim().min(20).max(200);
const ForgotBody = z.object({ email: Email });
const ResetBody = z.object({ token: Token, newPassword: NewPassword });
const ChangeBody = z.object({ currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH), newPassword: NewPassword });
const VerifyBody = z.object({ token: Token });

const INVALID_LINK = "El link no es válido o ya venció. Pedí uno nuevo.";

interface Deps {
  db: Db;
  mailer: Mailer;
  log: FastifyBaseLogger;
  appUrl: string;
}
type Account = { id: string; email: string };

/**
 * Emite un link de restablecimiento y lo envía en segundo plano. Lo usan
 * "olvidé mi contraseña" y el ADMIN para un miembro (createdBy + nombre de su organización).
 */
export async function sendPasswordReset(
  { db, mailer, log, appUrl }: Deps,
  user: Account,
  requestedBy?: { userId: string | null; organizationName: string },
) {
  const token = newSessionToken();
  await issueUserToken(db, {
    userId: user.id,
    purpose: "password_reset",
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + PASSWORD_RESET_MINUTES * 60 * 1000),
    createdBy: requestedBy?.userId,
  });
  notify(
    mailer,
    log,
    passwordResetEmail({
      to: user.email,
      url: appLink(appUrl, PASSWORD_RESET_PATH, token),
      minutes: PASSWORD_RESET_MINUTES,
      requestedByOrganization: requestedBy?.organizationName,
    }),
  );
}

/** Emite el link de verificación de email y lo envía en segundo plano. */
export async function sendEmailVerification({ db, mailer, log, appUrl }: Deps, user: Account) {
  const token = newSessionToken();
  await issueUserToken(db, {
    userId: user.id,
    purpose: "email_verification",
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_HOURS * 60 * 60 * 1000),
  });
  notify(mailer, log, verifyEmailEmail(user.email, appLink(appUrl, VERIFY_EMAIL_PATH, token)));
}

/** Palabras del contexto de la persona que no pueden aparecer en su contraseña. */
async function passwordContext(db: Db, user: { id: string; email: string; name: string | null }) {
  const orgs = await listMembershipsForUser(db, user.id);
  return { email: user.email, name: user.name, organizationName: orgs.map((o) => o.organizationName).join(" ") };
}

interface Options {
  db: Db;
  mailer: Mailer;
  appUrl: string;
  authRateLimit: number;
}

export async function passwordRoutes(app: FastifyInstance, { db, mailer, appUrl, authRateLimit }: Options) {
  const strict = { config: { rateLimit: { max: authRateLimit, timeWindow: "1 minute" } } };

  /**
   * Olvidé mi contraseña. Responde SIEMPRE lo mismo, exista o no el email (no permite
   * averiguar quién tiene cuenta), y el envío va en segundo plano.
   */
  app.post("/auth/password/forgot", strict, async (req, reply) => {
    const { email } = ForgotBody.parse(req.body);
    const user = await findUserByEmail(db, email);
    if (user && !(await issuedRecently(db, user.id, "password_reset", RESEND_SECONDS))) {
      await sendPasswordReset({ db, mailer, log: req.log, appUrl }, user);
    }
    return reply.code(202).send({
      message: "Si hay una cuenta con ese email, te enviamos un link para restablecer la contraseña.",
    });
  });

  /**
   * Restablecer con el link del email. Valida la contraseña ANTES de gastar el link,
   * cierra todas las sesiones y no inicia sesión: al entrar se sigue pidiendo MFA.
   */
  app.post("/auth/password/reset", strict, async (req, reply) => {
    const { token, newPassword } = ResetBody.parse(req.body);
    const tokenHash = hashToken(token);
    const pending = await peekUserToken(db, tokenHash, "password_reset");
    const user = pending ? await getUserById(db, pending.userId) : null;
    if (!user) return reply.code(400).send({ error: INVALID_LINK, code: "INVALID_TOKEN" });

    assertStrongPassword(newPassword, await passwordContext(db, user));
    const consumed = await consumeUserToken(db, tokenHash, "password_reset");
    if (!consumed) return reply.code(400).send({ error: INVALID_LINK, code: "INVALID_TOKEN" });

    await setPassword(db, user.id, await hashPassword(newPassword));
    await markEmailVerified(db, user.id); // el link llegó a esa casilla
    await recordForAllMemberships(db, user.id, "auth.password_reset", {
      requestedBy: consumed.createdBy ? "admin" : "self",
    });
    notify(mailer, req.log, passwordChangedEmail(user.email));
    return { message: "Listo: ya podés ingresar con tu contraseña nueva." };
  });

  /** Cambiar la contraseña estando dentro: exige la actual y cierra las OTRAS sesiones. */
  app.post("/auth/password", strict, async (req, reply) => {
    const current = await currentSession(db, req);
    if (!current) return reply.code(401).send({ error: "No autenticado" });
    const { user, tokenHash } = current;
    const { currentPassword, newPassword } = ChangeBody.parse(req.body);

    const locked = user.lockedUntil ? user.lockedUntil.getTime() > Date.now() : false;
    const ok = !locked && !!user.passwordHash && (await verifyPassword(currentPassword, user.passwordHash));
    if (!ok) {
      if (!locked) await failedAttempt(db, { mailer, log: req.log }, user);
      return reply.code(403).send({ error: "La contraseña actual no es correcta" });
    }
    if (newPassword === currentPassword) {
      return reply.code(400).send({ error: "La contraseña nueva tiene que ser distinta de la actual" });
    }
    assertStrongPassword(newPassword, await passwordContext(db, user));

    await setPassword(db, user.id, await hashPassword(newPassword), tokenHash);
    await recordForAllMemberships(db, user.id, "auth.password_changed");
    notify(mailer, req.log, passwordChangedEmail(user.email));
    return reply.code(204).send();
  });

  /** Confirmar el email con el link recibido. */
  app.post("/auth/email/verify", strict, async (req, reply) => {
    const { token } = VerifyBody.parse(req.body);
    const consumed = await consumeUserToken(db, hashToken(token), "email_verification");
    if (!consumed) return reply.code(400).send({ error: INVALID_LINK, code: "INVALID_TOKEN" });
    await markEmailVerified(db, consumed.userId);
    await recordForAllMemberships(db, consumed.userId, "user.email_verified");
    return { message: "¡Listo! Confirmaste tu email." };
  });

  /** Reenviar el link de verificación a la cuenta de la sesión. */
  app.post("/auth/email/verification", strict, async (req, reply) => {
    const current = await currentSession(db, req);
    if (!current) return reply.code(401).send({ error: "No autenticado" });
    if (current.user.emailVerifiedAt) return reply.code(409).send({ error: "Tu email ya está confirmado" });
    if (!(await issuedRecently(db, current.user.id, "email_verification", RESEND_SECONDS))) {
      await sendEmailVerification({ db, mailer, log: req.log, appUrl }, current.user);
    }
    return reply.code(202).send({ message: `Te enviamos un nuevo link a ${current.user.email}.` });
  });
}

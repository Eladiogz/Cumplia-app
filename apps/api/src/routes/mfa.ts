import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  clearLoginFailures,
  countUnusedRecoveryCodes,
  deleteMfaChallenge,
  deleteOtherSessionsForUser,
  disableMfa,
  enableMfa,
  findMfaChallenge,
  forOrganization,
  listMembershipsForUser,
  getUserById,
  registerFailedMfaChallenge,
  replaceRecoveryCodes,
  setPendingMfaSecret,
  type Db,
} from "@cumplia/db";
import { notify, type Mailer } from "../email/mailer.js";
import { mfaDisabledEmail, mfaEnabledEmail, recoveryCodeUsedEmail } from "../email/templates.js";
import { decrypt, encrypt } from "../security/encryption.js";
import { verifyPassword } from "../security/password.js";
import { SecondFactorFields, checkSecondFactor as checkFactor, isLocked, type User } from "../security/reauth.js";
import { MFA_CHALLENGE_COOKIE, currentSession, hashToken, startSession } from "../security/session.js";
import { base32Encode, hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUri, verifyTotp } from "../security/totp.js";
import { MAX_ATTEMPTS, failedAttempt } from "../security/lockout.js";
import { INVALID } from "./auth.js";

const SecondFactor = z
  .object(SecondFactorFields)
  .refine((b) => (b.code === undefined) !== (b.recoveryCode === undefined), {
    message: "Enviá code o recoveryCode (uno solo)",
  });

const EnableBody = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Código de 6 dígitos") });

const DisableBody = z.intersection(z.object({ password: z.string().min(1).max(128) }), SecondFactor);

interface Options {
  db: Db;
  secureCookies: boolean;
  authRateLimit: number;
  /** Clave AES-256 (32 bytes) con la que se cifran los secretos TOTP. */
  encryptionKey: Buffer;
  mailer: Mailer;
  mfaCookiePath: string;
}

export async function mfaRoutes(
  app: FastifyInstance,
  { db, secureCookies, authRateLimit, encryptionKey, mailer, mfaCookiePath }: Options,
) {
  const strict = { config: { rateLimit: { max: authRateLimit, timeWindow: "1 minute" } } };

  // El id del usuario autentica el cifrado: un secreto no sirve copiado a otra fila.
  const sealSecret = (userId: string, secret: Buffer) => encrypt(encryptionKey, secret, `mfa:${userId}`);
  const openSecret = (userId: string, sealed: string) => decrypt(encryptionKey, sealed, `mfa:${userId}`);

  const currentUser = (req: FastifyRequest) => currentSession(db, req);

  const checkSecondFactor = (user: User, input: { code?: string; recoveryCode?: string }) =>
    checkFactor(db, encryptionKey, user, input);

  /** Paso 1 de la activación: genera un secreto pendiente y devuelve los datos para el QR. */
  app.post("/auth/mfa/setup", strict, async (req, reply) => {
    const current = await currentUser(req);
    if (!current) return reply.code(401).send({ error: "No autenticado" });
    const { user } = current;
    if (user.mfaEnabledAt) return reply.code(409).send({ error: "MFA ya está activo" });

    const secret = newTotpSecret();
    if (!(await setPendingMfaSecret(db, user.id, sealSecret(user.id, secret)))) {
      return reply.code(409).send({ error: "MFA ya está activo" });
    }
    return { secret: base32Encode(secret), otpauthUri: otpauthUri(secret, user.email) };
  });

  /** Paso 2: confirma con un código de la app. Devuelve los códigos de recuperación UNA sola vez. */
  app.post("/auth/mfa/enable", strict, async (req, reply) => {
    const current = await currentUser(req);
    if (!current) return reply.code(401).send({ error: "No autenticado" });
    const { user, session, tokenHash } = current;
    if (user.mfaEnabledAt) return reply.code(409).send({ error: "MFA ya está activo" });
    if (!user.mfaSecret) return reply.code(409).send({ error: "Primero iniciá la configuración" });

    const { code } = EnableBody.parse(req.body);
    const step = verifyTotp(openSecret(user.id, user.mfaSecret), code);
    if (step === null) return reply.code(400).send({ error: "Código inválido" });

    const recoveryCodes = newRecoveryCodes();
    if (!(await enableMfa(db, user.id, step, recoveryCodes.map(hashRecoveryCode)))) {
      return reply.code(409).send({ error: "MFA ya está activo" });
    }
    // Cualquier otra sesión abierta se inició sin segundo factor: se cierra.
    await deleteOtherSessionsForUser(db, user.id, tokenHash);
    await forOrganization(db, session.organizationId, user.id).record("mfa.enabled", "user", user.id);
    notify(mailer, req.log, mfaEnabledEmail(user.email));
    return { recoveryCodes };
  });

  /** Genera códigos de recuperación nuevos (invalida los anteriores). Exige un código de la app. */
  app.post("/auth/mfa/recovery-codes", strict, async (req, reply) => {
    const current = await currentUser(req);
    if (!current) return reply.code(401).send({ error: "No autenticado" });
    const { user, session } = current;
    if (!user.mfaEnabledAt) return reply.code(409).send({ error: "MFA no está activo" });

    const { code } = EnableBody.parse(req.body);
    if (isLocked(user) || (await checkSecondFactor(user, { code })) === null) {
      if (!isLocked(user)) await failedAttempt(db, { mailer, log: req.log }, user);
      return reply.code(403).send({ error: "Código inválido" });
    }
    const recoveryCodes = newRecoveryCodes();
    await replaceRecoveryCodes(db, user.id, recoveryCodes.map(hashRecoveryCode));
    await forOrganization(db, session.organizationId, user.id).record("mfa.recovery_codes_regenerated", "user", user.id);
    return { recoveryCodes };
  });

  /** Segundo paso del login: canjea el desafío + código por una sesión. */
  app.post("/auth/mfa/verify", strict, async (req, reply) => {
    const body = SecondFactor.parse(req.body);
    const token = req.cookies[MFA_CHALLENGE_COOKIE];
    const challenge = token ? await findMfaChallenge(db, hashToken(token)) : null;
    if (!challenge) return reply.code(401).send({ error: "El inicio de sesión venció; volvé a ingresar" });

    const user = await getUserById(db, challenge.userId);
    // La membresía de la organización del desafío (la FK lo garantiza, pero el rol se lee ahora).
    const membership = user
      ? (await listMembershipsForUser(db, user.id)).find((m) => m.organizationId === challenge.organizationId)
      : undefined;
    if (!user || !user.mfaEnabledAt || !membership) {
      await deleteMfaChallenge(db, challenge.id);
      return reply.code(401).send({ error: INVALID });
    }
    const audit = forOrganization(db, challenge.organizationId, user.id);

    const method = isLocked(user) ? null : await checkSecondFactor(user, body);
    if (!method) {
      if (!isLocked(user)) await failedAttempt(db, { mailer, log: req.log }, user);
      await registerFailedMfaChallenge(db, challenge.id, MAX_ATTEMPTS);
      await audit.record("auth.mfa_failed", "user", user.id, {
        reason: isLocked(user) ? "account_locked" : "invalid_code",
        method: body.code !== undefined ? "totp" : "recovery_code",
      });
      return reply.code(401).send({ error: INVALID });
    }

    await deleteMfaChallenge(db, challenge.id);
    await clearLoginFailures(db, user.id);
    await startSession(db, req, reply, { userId: user.id, organizationId: challenge.organizationId, secureCookies });
    reply.clearCookie(MFA_CHALLENGE_COOKIE, { path: mfaCookiePath });
    const remaining = method === "recovery" ? await countUnusedRecoveryCodes(db, user.id) : null;
    if (remaining !== null) {
      await audit.record("mfa.recovery_code_used", "user", user.id, { remaining });
      notify(mailer, req.log, recoveryCodeUsedEmail(user.email, remaining));
    }
    await audit.record("auth.login", "user", user.id);
    return {
      user: { id: user.id, email: user.email, name: user.name },
      organization: { id: membership.organizationId, name: membership.organizationName },
      role: membership.role,
      ...(remaining !== null ? { recoveryCodesRemaining: remaining } : {}),
    };
  });

  /** Desactivar exige contraseña y segundo factor: una sesión robada no alcanza. */
  app.post("/auth/mfa/disable", strict, async (req, reply) => {
    const current = await currentUser(req);
    if (!current) return reply.code(401).send({ error: "No autenticado" });
    const { user, session } = current;
    if (!user.mfaEnabledAt) return reply.code(409).send({ error: "MFA no está activo" });
    // Cualquiera de sus organizaciones (no solo la activa) puede exigirlo.
    const requiring = (await listMembershipsForUser(db, user.id)).filter((m) => m.requireMfa);
    if (requiring.length > 0) {
      return reply.code(409).send({
        error: `No se puede desactivar: lo exige ${requiring.map((m) => m.organizationName).join(", ")}`,
      });
    }

    const body = DisableBody.parse(req.body);
    const audit = forOrganization(db, session.organizationId, user.id);
    const passwordOk = !!user.passwordHash && (await verifyPassword(body.password, user.passwordHash));
    const ok = !isLocked(user) && passwordOk && (await checkSecondFactor(user, body)) !== null;
    if (!ok) {
      if (!isLocked(user)) await failedAttempt(db, { mailer, log: req.log }, user);
      await audit.record("mfa.disable_failed", "user", user.id);
      return reply.code(403).send({ error: "No se pudo verificar tu identidad" });
    }

    await disableMfa(db, user.id);
    await audit.record("mfa.disabled", "user", user.id);
    notify(mailer, req.log, mfaDisabledEmail(user.email));
    return reply.code(204).send();
  });
}

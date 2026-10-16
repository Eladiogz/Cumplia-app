import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  clearLoginFailures,
  consumeRecoveryCode,
  consumeTotpStep,
  countUnusedRecoveryCodes,
  deleteMfaChallenge,
  deleteOtherSessionsForUser,
  disableMfa,
  enableMfa,
  findMfaChallenge,
  forOrganization,
  listMembershipsForUser,
  getUserById,
  registerFailedLogin,
  registerFailedMfaChallenge,
  setPendingMfaSecret,
  type Db,
} from "@cumplia/db";
import { decrypt, encrypt } from "../security/encryption.js";
import { verifyPassword } from "../security/password.js";
import { MFA_CHALLENGE_COOKIE, MFA_CHALLENGE_PATH, currentSession, hashToken, startSession } from "../security/session.js";
import {
  base32Encode,
  hashRecoveryCode,
  newRecoveryCodes,
  newTotpSecret,
  otpauthUri,
  verifyTotp,
} from "../security/totp.js";
import { INVALID, LOCK_MINUTES, MAX_ATTEMPTS } from "./auth.js";

const SecondFactor = z
  .object({
    code: z.string().trim().regex(/^\d{6}$/, "Código de 6 dígitos").optional(),
    recoveryCode: z.string().trim().min(10).max(32).optional(),
  })
  .refine((b) => (b.code === undefined) !== (b.recoveryCode === undefined), {
    message: "Enviá code o recoveryCode (uno solo)",
  });

const EnableBody = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Código de 6 dígitos") });

const DisableBody = z.intersection(z.object({ password: z.string().min(1).max(128) }), SecondFactor);

type User = NonNullable<Awaited<ReturnType<typeof getUserById>>>;

interface Options {
  db: Db;
  secureCookies: boolean;
  authRateLimit: number;
  /** Clave AES-256 (32 bytes) con la que se cifran los secretos TOTP. */
  encryptionKey: Buffer;
}

export async function mfaRoutes(app: FastifyInstance, { db, secureCookies, authRateLimit, encryptionKey }: Options) {
  const strict = { config: { rateLimit: { max: authRateLimit, timeWindow: "1 minute" } } };

  // El id del usuario autentica el cifrado: un secreto no sirve copiado a otra fila.
  const sealSecret = (userId: string, secret: Buffer) => encrypt(encryptionKey, secret, `mfa:${userId}`);
  const openSecret = (userId: string, sealed: string) => decrypt(encryptionKey, sealed, `mfa:${userId}`);

  const isLocked = (user: User) => (user.lockedUntil ? user.lockedUntil.getTime() > Date.now() : false);

  const currentUser = (req: FastifyRequest) => currentSession(db, req);

  /** Verifica un código TOTP (sin reutilizar pasos) o gasta un código de recuperación. */
  const checkSecondFactor = async (user: User, input: { code?: string; recoveryCode?: string }) => {
    if (input.code !== undefined) {
      if (!user.mfaSecret) return null;
      const step = verifyTotp(openSecret(user.id, user.mfaSecret), input.code);
      return step !== null && (await consumeTotpStep(db, user.id, step)) ? ("totp" as const) : null;
    }
    if (input.recoveryCode !== undefined) {
      return (await consumeRecoveryCode(db, user.id, hashRecoveryCode(input.recoveryCode))) ? ("recovery" as const) : null;
    }
    return null;
  };

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
      if (!isLocked(user)) await registerFailedLogin(db, user.id, MAX_ATTEMPTS, LOCK_MINUTES);
      await registerFailedMfaChallenge(db, challenge.id, MAX_ATTEMPTS);
      await audit.record("auth.mfa_failed", "user", user.id, {
        reason: isLocked(user) ? "account_locked" : "invalid_code",
        method: body.code !== undefined ? "totp" : "recovery_code",
      });
      return reply.code(401).send({ error: INVALID });
    }

    await deleteMfaChallenge(db, challenge.id);
    await clearLoginFailures(db, user.id);
    await startSession(db, reply, { userId: user.id, organizationId: challenge.organizationId, secureCookies });
    reply.clearCookie(MFA_CHALLENGE_COOKIE, { path: MFA_CHALLENGE_PATH });
    if (method === "recovery") await audit.record("mfa.recovery_code_used", "user", user.id);
    await audit.record("auth.login", "user", user.id);
    return {
      user: { id: user.id, email: user.email, name: user.name },
      organization: { id: membership.organizationId, name: membership.organizationName },
      role: membership.role,
      ...(method === "recovery" ? { recoveryCodesRemaining: await countUnusedRecoveryCodes(db, user.id) } : {}),
    };
  });

  /** Desactivar exige contraseña y segundo factor: una sesión robada no alcanza. */
  app.post("/auth/mfa/disable", strict, async (req, reply) => {
    const current = await currentUser(req);
    if (!current) return reply.code(401).send({ error: "No autenticado" });
    const { user, session } = current;
    if (!user.mfaEnabledAt) return reply.code(409).send({ error: "MFA no está activo" });
    if (session.organizationRequiresMfa) {
      return reply.code(409).send({ error: "Tu organización exige MFA: no se puede desactivar" });
    }

    const body = DisableBody.parse(req.body);
    const audit = forOrganization(db, session.organizationId, user.id);
    const passwordOk = !!user.passwordHash && (await verifyPassword(body.password, user.passwordHash));
    const ok = !isLocked(user) && passwordOk && (await checkSecondFactor(user, body)) !== null;
    if (!ok) {
      if (!isLocked(user)) await registerFailedLogin(db, user.id, MAX_ATTEMPTS, LOCK_MINUTES);
      await audit.record("mfa.disable_failed", "user", user.id);
      return reply.code(403).send({ error: "No se pudo verificar tu identidad" });
    }

    await disableMfa(db, user.id);
    await audit.record("mfa.disabled", "user", user.id);
    return reply.code(204).send();
  });
}

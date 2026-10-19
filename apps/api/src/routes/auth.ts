import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  ConflictError,
  clearLoginFailures,
  createMfaChallenge,
  deleteSession,
  findActiveSession,
  findUserByEmail,
  forOrganization,
  getLoginMembership,
  getUserById,
  registerUserWithOrganization,
  type Db,
} from "@cumplia/db";
import type { Mailer } from "../email/mailer.js";
import { failedAttempt } from "../security/lockout.js";
import { dummyHash, hashPassword, verifyPassword } from "../security/password.js";
import { assertStrongPassword } from "../security/password-policy.js";
import { sendEmailVerification } from "./password.js";
import { Email, NewPassword, OrganizationName, PersonName } from "./schemas.js";
import {
  MFA_CHALLENGE_COOKIE,
  MFA_CHALLENGE_MINUTES,
  SESSION_COOKIE,
  hashToken,
  mfaChallengeExpiry,
  newSessionToken,
  startSession,
} from "../security/session.js";

export const INVALID = "Credenciales inválidas";

const RegisterBody = z.object({
  email: Email,
  password: NewPassword,
  name: PersonName.optional(),
  organizationName: OrganizationName,
});

const LoginBody = z.object({ email: Email, password: z.string().min(1).max(128) });

interface Options {
  db: Db;
  secureCookies: boolean;
  /** Máximo de peticiones por minuto y por IP a registro e inicio de sesión. */
  authRateLimit: number;
  mailer: Mailer;
  /** Ruta (vista desde el navegador) a la que viaja la cookie del desafío MFA. */
  mfaCookiePath: string;
  /** URL del frontend para los links de los emails. */
  appUrl: string;
}

export async function authRoutes(
  app: FastifyInstance,
  { db, secureCookies, authRateLimit, mailer, mfaCookiePath, appUrl }: Options,
) {
  // Límite propio y más estricto que el global para frenar fuerza bruta.
  const strict = { config: { rateLimit: { max: authRateLimit, timeWindow: "1 minute" } } };

  /** Segundo paso del login: la sesión recién se crea en POST /auth/mfa/verify. */
  const startMfaChallenge = async (userId: string, organizationId: string, reply: FastifyReply) => {
    const token = newSessionToken();
    await createMfaChallenge(db, { userId, organizationId, tokenHash: hashToken(token), expiresAt: mfaChallengeExpiry() });
    reply.setCookie(MFA_CHALLENGE_COOKIE, token, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "strict",
      path: mfaCookiePath,
      maxAge: MFA_CHALLENGE_MINUTES * 60,
    });
  };

  app.post("/auth/register", strict, async (req, reply) => {
    const body = RegisterBody.parse(req.body);
    assertStrongPassword(body.password, { email: body.email, name: body.name, organizationName: body.organizationName });
    try {
      const { user, organization, role } = await registerUserWithOrganization(db, {
        email: body.email,
        name: body.name,
        passwordHash: await hashPassword(body.password),
        organizationName: body.organizationName,
      });
      await startSession(db, req, reply, { userId: user.id, organizationId: organization.id, secureCookies });
      // Puede usar la cuenta ya; algunas acciones (invitar) esperan a que confirme el email.
      await sendEmailVerification({ db, mailer, log: req.log, appUrl }, user);
      return reply.code(201).send({
        user: { id: user.id, email: user.email, name: user.name },
        organization: { id: organization.id, name: organization.name },
        role,
      });
    } catch (e) {
      if (e instanceof ConflictError) return reply.code(409).send({ error: "No se pudo completar el registro" });
      throw e;
    }
  });

  app.post("/auth/login", strict, async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const user = await findUserByEmail(db, body.email);

    // Siempre se gasta el mismo trabajo, exista o no el usuario.
    const hash = user?.passwordHash ?? (await dummyHash());
    const passwordOk = await verifyPassword(body.password, hash);
    const locked = user?.lockedUntil ? user.lockedUntil.getTime() > Date.now() : false;

    if (!user || !user.passwordHash || !passwordOk || locked) {
      if (user && !locked) await failedAttempt(db, { mailer, log: req.log }, user);
      const membership = user ? await getLoginMembership(db, user.id) : null;
      if (user && membership) {
        await forOrganization(db, membership.organizationId, user.id).record("auth.login_failed", "user", user.id, {
          reason: locked ? "account_locked" : "invalid_credentials",
        });
      }
      return reply.code(401).send({ error: INVALID });
    }

    const membership = await getLoginMembership(db, user.id);
    if (!membership) return reply.code(401).send({ error: INVALID });

    // Con MFA activo la contraseña sola no alcanza. El contador de fallos no se
    // reinicia hasta que el código también sea correcto.
    if (user.mfaEnabledAt) {
      await startMfaChallenge(user.id, membership.organizationId, reply);
      return { mfaRequired: true };
    }

    await clearLoginFailures(db, user.id);
    await startSession(db, req, reply, { userId: user.id, organizationId: membership.organizationId, secureCookies });
    await forOrganization(db, membership.organizationId, user.id).record("auth.login", "user", user.id);
    return {
      user: { id: user.id, email: user.email, name: user.name },
      organization: { id: membership.organizationId, name: membership.organizationName },
      role: membership.role,
    };
  });

  app.post("/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const session = await findActiveSession(db, hashToken(token));
      await deleteSession(db, hashToken(token));
      if (session) {
        await forOrganization(db, session.organizationId, session.userId).record("auth.logout", "user", session.userId);
      }
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  app.get("/auth/me", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    const session = token ? await findActiveSession(db, hashToken(token)) : null;
    const user = session ? await getUserById(db, session.userId) : null;
    if (!session || !user) return reply.code(401).send({ error: "No autenticado" });
    return {
      user: { id: user.id, email: user.email, name: user.name },
      organizationId: session.organizationId,
      role: session.role,
      mfaEnabled: user.mfaEnabledAt !== null,
      emailVerified: user.emailVerifiedAt !== null,
      // El frontend lo usa para llevar al usuario a configurar MFA antes que nada.
      mfaSetupRequired: session.organizationRequiresMfa && user.mfaEnabledAt === null,
    };
  });
}

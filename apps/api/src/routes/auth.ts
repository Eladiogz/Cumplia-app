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
  getPrimaryMembership,
  getUserById,
  registerFailedLogin,
  registerUserWithOrganization,
  type Db,
} from "@cumplia/db";
import { dummyHash, hashPassword, verifyPassword } from "../security/password.js";
import {
  MFA_CHALLENGE_COOKIE,
  MFA_CHALLENGE_MINUTES,
  MFA_CHALLENGE_PATH,
  SESSION_COOKIE,
  hashToken,
  mfaChallengeExpiry,
  newSessionToken,
  startSession,
} from "../security/session.js";

export const MAX_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
export const INVALID = "Credenciales inválidas";

const Email = z.string().trim().toLowerCase().email().max(254);
const Password = z.string().min(12, "Mínimo 12 caracteres").max(128);

const RegisterBody = z
  .object({
    email: Email,
    password: Password,
    name: z.string().trim().min(1).max(100).optional(),
    organizationName: z.string().trim().min(2).max(120),
  })
  .refine((b) => b.password.toLowerCase() !== b.email, { message: "La contraseña no puede ser el email", path: ["password"] });

const LoginBody = z.object({ email: Email, password: z.string().min(1).max(128) });

interface Options {
  db: Db;
  secureCookies: boolean;
  /** Máximo de peticiones por minuto y por IP a registro e inicio de sesión. */
  authRateLimit: number;
}

export async function authRoutes(app: FastifyInstance, { db, secureCookies, authRateLimit }: Options) {
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
      path: MFA_CHALLENGE_PATH,
      maxAge: MFA_CHALLENGE_MINUTES * 60,
    });
  };

  app.post("/auth/register", strict, async (req, reply) => {
    const body = RegisterBody.parse(req.body);
    try {
      const { user, organization, role } = await registerUserWithOrganization(db, {
        email: body.email,
        name: body.name,
        passwordHash: await hashPassword(body.password),
        organizationName: body.organizationName,
      });
      await startSession(db, reply, { userId: user.id, organizationId: organization.id, secureCookies });
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
      if (user && !locked) await registerFailedLogin(db, user.id, MAX_ATTEMPTS, LOCK_MINUTES);
      const membership = user ? await getPrimaryMembership(db, user.id) : null;
      if (user && membership) {
        await forOrganization(db, membership.organizationId, user.id).record("auth.login_failed", "user", user.id);
      }
      return reply.code(401).send({ error: INVALID });
    }

    const membership = await getPrimaryMembership(db, user.id);
    if (!membership) return reply.code(401).send({ error: INVALID });

    // Con MFA activo la contraseña sola no alcanza. El contador de fallos no se
    // reinicia hasta que el código también sea correcto.
    if (user.mfaEnabledAt) {
      await startMfaChallenge(user.id, membership.organizationId, reply);
      return { mfaRequired: true };
    }

    await clearLoginFailures(db, user.id);
    await startSession(db, reply, { userId: user.id, organizationId: membership.organizationId, secureCookies });
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
      // El frontend lo usa para llevar al usuario a configurar MFA antes que nada.
      mfaSetupRequired: session.organizationRequiresMfa && user.mfaEnabledAt === null,
    };
  });
}

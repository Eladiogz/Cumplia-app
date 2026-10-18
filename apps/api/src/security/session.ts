import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createSession, findActiveSession, getUserById, touchSession, type Db } from "@cumplia/db";

export const SESSION_COOKIE = "cumplia_session";
export const SESSION_DAYS = 7;

/** Cookie del segundo paso del login: vida corta y solo viaja a /auth/mfa. */
export const MFA_CHALLENGE_COOKIE = "cumplia_mfa";
export const MFA_CHALLENGE_PATH = "/auth/mfa";
export const MFA_CHALLENGE_MINUTES = 5;

/** Token aleatorio de 256 bits que viaja en la cookie. */
export const newSessionToken = () => randomBytes(32).toString("base64url");

/** Lo único que se guarda en la base. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const sessionExpiry = () => new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

export const mfaChallengeExpiry = () => new Date(Date.now() + MFA_CHALLENGE_MINUTES * 60 * 1000);

/**
 * Sesión completa (no un desafío MFA) y usuario de la petición, o null.
 * Para rutas de cuenta que no dependen de la organización activa.
 */
export async function currentSession(db: Db, req: FastifyRequest) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = await findActiveSession(db, tokenHash);
  if (session) await touchSession(db, session);
  const user = session ? await getUserById(db, session.userId) : null;
  return session && user ? { session, user, tokenHash } : null;
}

/** Navegador tal como lo informa (acotado: es texto del cliente, solo se muestra a su dueño). */
export const userAgentOf = (req: FastifyRequest) => {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua.trim() ? ua.trim().slice(0, 300) : null;
};

/** Crea la sesión en la base (con navegador e IP, para que la persona la reconozca) y deja la cookie. */
export async function startSession(
  db: Db,
  req: FastifyRequest,
  reply: FastifyReply,
  { userId, organizationId, secureCookies }: { userId: string; organizationId: string; secureCookies: boolean },
) {
  const token = newSessionToken();
  await createSession(db, {
    userId,
    organizationId,
    tokenHash: hashToken(token),
    expiresAt: sessionExpiry(),
    userAgent: userAgentOf(req),
    // Con TRUST_PROXY, req.ip es la IP real del cliente (no la de la web).
    ipAddress: req.ip || null,
  });
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

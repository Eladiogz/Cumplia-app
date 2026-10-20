import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ConflictError,
  acceptInvitation,
  deleteOtherSessionsForUser,
  deleteSession,
  deleteSessionOfUser,
  deleteUserAccount,
  findInvitationByToken,
  forOrganization,
  listMembershipsForUser,
  listSessionsForUser,
  recordForAllMemberships,
  registerFromInvitation,
  updateUserName,
  type Db,
} from "@cumplia/db";
import { notify, type Mailer } from "../email/mailer.js";
import { accountDeletedEmail } from "../email/templates.js";
import { hashPassword } from "../security/password.js";
import { assertStrongPassword } from "../security/password-policy.js";
import { ReauthBody, confirmIdentity } from "../security/reauth.js";
import { SESSION_COOKIE, currentSession, hashToken, startSession } from "../security/session.js";
import { Email, NewPassword, PersonName } from "./schemas.js";

const Token = z.string().trim().min(20).max(200);
const PreviewBody = z.object({ token: Token });
const AcceptBody = z.object({
  token: Token,
  // Solo para crear una cuenta nueva; con sesión iniciada se ignoran.
  password: NewPassword.optional(),
  name: PersonName.optional(),
});
const SwitchBody = z.object({ organizationId: z.string().uuid() });
const SessionParams = z.object({ sessionId: z.string().uuid() });
const ProfileBody = z.object({ name: PersonName });
// Escribir el propio email confirma que se entiende qué cuenta se elimina.
const DeleteAccountBody = ReauthBody.extend({ confirmEmail: Email });

const INVALID_INVITATION = "La invitación no es válida o ya venció";

interface Options {
  db: Db;
  secureCookies: boolean;
  authRateLimit: number;
  mailer: Mailer;
  /** Para verificar el código MFA al eliminar la cuenta (sin ella, quien tiene MFA no puede). */
  encryptionKey?: Buffer;
}

/**
 * Rutas de la cuenta que no dependen de la organización activa: aceptar
 * invitaciones, elegir con qué organización trabajar y los datos propios.
 */
export async function accountRoutes(app: FastifyInstance, { db, secureCookies, authRateLimit, mailer, encryptionKey }: Options) {
  const strict = { config: { rateLimit: { max: authRateLimit, timeWindow: "1 minute" } } };

  /** Abre una sesión en `organizationId` y, si había otra, la cierra (rotación de token). */
  const moveSession = async (req: FastifyRequest, reply: FastifyReply, userId: string, organizationId: string, oldTokenHash?: string) => {
    await startSession(db, req, reply, { userId, organizationId, secureCookies });
    if (oldTokenHash) await deleteSession(db, oldTokenHash);
  };

  /** "Te invitaron a X como Y": para la pantalla previa a aceptar. */
  app.post("/auth/invitations/preview", strict, async (req, reply) => {
    const { token } = PreviewBody.parse(req.body);
    const inv = await findInvitationByToken(db, hashToken(token));
    if (!inv) return reply.code(404).send({ error: INVALID_INVITATION });
    return { organizationName: inv.organizationName, email: inv.email, role: inv.role, expiresAt: inv.expiresAt };
  });

  /**
   * Con sesión: la cuenta actual se une (el email debe coincidir) y pasa a esa organización.
   * Sin sesión: crea la cuenta con el email de la invitación. Si el email ya tiene
   * cuenta, hay que iniciar sesión primero (así se respeta su contraseña y su MFA).
   */
  app.post("/auth/invitations/accept", strict, async (req, reply) => {
    const body = AcceptBody.parse(req.body);
    const tokenHash = hashToken(body.token);
    const current = await currentSession(db, req);

    if (current) {
      const result = await acceptInvitation(db, { tokenHash, userId: current.user.id, userEmail: current.user.email });
      if (result.status === "invalid") return reply.code(404).send({ error: INVALID_INVITATION });
      if (result.status === "wrong_account") {
        return reply.code(403).send({ error: "Esta invitación es para otra cuenta" });
      }
      const { invitation } = result;
      await moveSession(req, reply, current.user.id, invitation.organizationId, current.tokenHash);
      return {
        organization: { id: invitation.organizationId, name: invitation.organizationName },
        role: invitation.role,
      };
    }

    if (!body.password) return reply.code(400).send({ error: "Para crear tu cuenta, elegí una contraseña" });
    const preview = await findInvitationByToken(db, tokenHash);
    if (!preview) return reply.code(404).send({ error: INVALID_INVITATION });
    assertStrongPassword(body.password, {
      email: preview.email,
      name: body.name,
      organizationName: preview.organizationName,
    });
    try {
      const created = await registerFromInvitation(db, {
        tokenHash,
        passwordHash: await hashPassword(body.password),
        name: body.name,
      });
      if (!created) return reply.code(404).send({ error: INVALID_INVITATION });
      const { user, invitation } = created;
      await moveSession(req, reply, user.id, invitation.organizationId);
      return reply.code(201).send({
        user: { id: user.id, email: user.email, name: user.name },
        organization: { id: invitation.organizationId, name: invitation.organizationName },
        role: invitation.role,
      });
    } catch (e) {
      if (e instanceof ConflictError) return reply.code(409).send({ error: e.message });
      throw e;
    }
  });

  /**
   * Sesiones abiertas de la propia cuenta (en todas sus organizaciones), marcando la
   * actual. Sirve para detectar un acceso que no reconocés y cerrarlo (ISO A.8.5).
   */
  app.get("/auth/sessions", async (req, reply) => {
    const current = await currentSession(db, req);
    if (!current) return reply.code(401).send({ error: "No autenticado" });
    const list = await listSessionsForUser(db, current.user.id);
    return list.map((s) => ({ ...s, current: s.id === current.session.sessionId }));
  });

  /** Cierra todas las sesiones de la cuenta menos esta. */
  app.post("/auth/sessions/revoke-others", async (req, reply) => {
    const current = await currentSession(db, req);
    if (!current) return reply.code(401).send({ error: "No autenticado" });
    const closed = await deleteOtherSessionsForUser(db, current.user.id, current.tokenHash);
    await recordForAllMemberships(db, current.user.id, "auth.other_sessions_closed", { sessions: closed });
    return { closed };
  });

  /** Cierra UNA sesión propia. La de otra cuenta responde 404 (no se revela que existe). */
  app.delete("/auth/sessions/:sessionId", async (req, reply) => {
    const current = await currentSession(db, req);
    if (!current) return reply.code(401).send({ error: "No autenticado" });
    const { sessionId } = SessionParams.parse(req.params);
    if (sessionId === current.session.sessionId) {
      return reply.code(400).send({ error: "Para cerrar la sesión actual, usá «Cerrar sesión»" });
    }
    const closed = await deleteSessionOfUser(db, current.user.id, sessionId);
    if (!closed) return reply.code(404).send({ error: "Sesión no encontrada" });
    await forOrganization(db, closed.organizationId, current.user.id).record("auth.session_closed", "session", sessionId);
    return reply.code(204).send();
  });

  /** Organizaciones del usuario, marcando la activa. */
  app.get("/auth/organizations", async (req, reply) => {
    const current = await currentSession(db, req);
    if (!current) return reply.code(401).send({ error: "No autenticado" });
    const list = await listMembershipsForUser(db, current.user.id);
    return list.map((m) => ({ ...m, active: m.organizationId === current.session.organizationId }));
  });

  /** Cambia la organización activa: nueva sesión atada a esa membresía, la anterior se cierra. */
  app.post("/auth/switch-organization", async (req, reply) => {
    const current = await currentSession(db, req);
    if (!current) return reply.code(401).send({ error: "No autenticado" });
    const { organizationId } = SwitchBody.parse(req.body);
    const target = (await listMembershipsForUser(db, current.user.id)).find((m) => m.organizationId === organizationId);
    // 404 y no 403: no se revela si la organización existe.
    if (!target) return reply.code(404).send({ error: "Organización no encontrada" });

    await moveSession(req, reply, current.user.id, organizationId, current.tokenHash);
    await forOrganization(db, organizationId, current.user.id).record("auth.switch_organization", "user", current.user.id);
    return { organization: { id: target.organizationId, name: target.organizationName }, role: target.role };
  });

  /** Corregir el nombre propio (derecho de rectificación). El email identifica la cuenta y no cambia. */
  app.patch("/auth/me", async (req, reply) => {
    const current = await currentSession(db, req);
    if (!current) return reply.code(401).send({ error: "No autenticado" });
    const { name } = ProfileBody.parse(req.body);
    const user = await updateUserName(db, current.user.id, name);
    return { user };
  });

  /**
   * Eliminar la propia cuenta (derecho de supresión). Pide contraseña y, con MFA, un
   * código: una sesión robada no alcanza. Si la persona es el único ADMIN de alguna
   * organización, responde 409 con qué hacer antes.
   */
  app.post("/auth/account/delete", strict, async (req, reply) => {
    const current = await currentSession(db, req);
    if (!current) return reply.code(401).send({ error: "No autenticado" });
    const { user, session } = current;
    const body = DeleteAccountBody.parse(req.body);
    if (body.confirmEmail !== user.email) {
      return reply.code(400).send({ error: "Escribí el email de tu cuenta para confirmar" });
    }
    if (!(await confirmIdentity({ db, mailer, log: req.log, encryptionKey }, user, body))) {
      await forOrganization(db, session.organizationId, user.id).record("user.account_delete_failed", "user", user.id);
      return reply.code(403).send({ error: "No se pudo verificar tu identidad" });
    }
    try {
      await deleteUserAccount(db, user.id);
    } catch (e) {
      if (e instanceof ConflictError) return reply.code(409).send({ error: e.message });
      throw e;
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    notify(mailer, req.log, accountDeletedEmail(user.email));
    return reply.code(204).send();
  });
}

import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  ConflictError,
  acceptInvitation,
  deleteSession,
  findInvitationByToken,
  forOrganization,
  listMembershipsForUser,
  registerFromInvitation,
  type Db,
} from "@cumplia/db";
import { hashPassword } from "../security/password.js";
import { assertStrongPassword } from "../security/password-policy.js";
import { currentSession, hashToken, startSession } from "../security/session.js";
import { NewPassword } from "./schemas.js";

const Token = z.string().trim().min(20).max(200);
const PreviewBody = z.object({ token: Token });
const AcceptBody = z.object({
  token: Token,
  // Solo para crear una cuenta nueva; con sesión iniciada se ignoran.
  password: NewPassword.optional(),
  name: z.string().trim().min(1).max(100).optional(),
});
const SwitchBody = z.object({ organizationId: z.string().uuid() });

const INVALID_INVITATION = "La invitación no es válida o ya venció";

interface Options {
  db: Db;
  secureCookies: boolean;
  authRateLimit: number;
}

/**
 * Rutas de la cuenta que no dependen de la organización activa: aceptar
 * invitaciones y elegir con qué organización trabajar.
 */
export async function accountRoutes(app: FastifyInstance, { db, secureCookies, authRateLimit }: Options) {
  const strict = { config: { rateLimit: { max: authRateLimit, timeWindow: "1 minute" } } };

  /** Abre una sesión en `organizationId` y, si había otra, la cierra (rotación de token). */
  const moveSession = async (reply: FastifyReply, userId: string, organizationId: string, oldTokenHash?: string) => {
    await startSession(db, reply, { userId, organizationId, secureCookies });
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
      await moveSession(reply, current.user.id, invitation.organizationId, current.tokenHash);
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
      await moveSession(reply, user.id, invitation.organizationId);
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

    await moveSession(reply, current.user.id, organizationId, current.tokenHash);
    await forOrganization(db, organizationId, current.user.id).record("auth.switch_organization", "user", current.user.id);
    return { organization: { id: target.organizationId, name: target.organizationName }, role: target.role };
  });
}

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { forOrganization, type Db } from "@cumplia/db";
import { requires } from "../security/permissions.js";
import { hashToken, newSessionToken } from "../security/session.js";
import { RoleSchema } from "../tenant.js";
import { Email } from "./auth.js";

export const INVITATION_DAYS = 7;

const InvitationBody = z.object({ email: Email, role: RoleSchema });
const InvitationParams = z.object({ invitationId: z.string().uuid() });

interface Options {
  db: Db;
}

/** Gestión de invitaciones de la organización activa (dentro de protectedRoutes). */
export async function invitationRoutes(app: FastifyInstance, { db }: Options) {
  const repo = (req: FastifyRequest) => {
    if (!req.tenant) throw new Error("Tenant ausente");
    return forOrganization(db, req.tenant.organizationId, req.tenant.actorId);
  };

  /**
   * Devuelve el token UNA sola vez (en la base queda solo su hash). Hasta que exista
   * envío de emails, el ADMIN comparte el link por su cuenta.
   */
  app.post("/invitations", requires("members:manage"), async (req, reply) => {
    const { email, role } = InvitationBody.parse(req.body);
    const token = newSessionToken();
    const invitation = await repo(req).createInvitation({
      email,
      role,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000),
    });
    return reply.code(201).send({ ...invitation, token });
  });

  app.get("/invitations", requires("members:read"), async (req) => repo(req).listInvitations());

  app.delete("/invitations/:invitationId", requires("members:manage"), async (req, reply) => {
    const { invitationId } = InvitationParams.parse(req.params);
    await repo(req).revokeInvitation(invitationId);
    return reply.code(204).send();
  });
}

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { forOrganization, getUserById, type Db } from "@cumplia/db";
import type { Mailer } from "../email/mailer.js";
import { invitationEmail } from "../email/templates.js";
import { requires } from "../security/permissions.js";
import { hashToken, newSessionToken } from "../security/session.js";
import { RoleSchema } from "../tenant.js";
import { Email } from "./auth.js";

export const INVITATION_DAYS = 7;

const InvitationBody = z.object({ email: Email, role: RoleSchema });
const InvitationParams = z.object({ invitationId: z.string().uuid() });

interface Options {
  db: Db;
  mailer: Mailer;
  /** URL del frontend; el link de aceptación es `${appUrl}/invitaciones/aceptar#token=...`. */
  appUrl: string;
}

/** Link de aceptación. El token va en el fragmento (#): el navegador no lo envía a ningún servidor ni en el Referer. */
export const acceptUrl = (appUrl: string, token: string) =>
  `${appUrl.replace(/\/$/, "")}/invitaciones/aceptar#token=${encodeURIComponent(token)}`;

/** Gestión de invitaciones de la organización activa (dentro de protectedRoutes). */
export async function invitationRoutes(app: FastifyInstance, { db, mailer, appUrl }: Options) {
  const tenantOf = (req: FastifyRequest) => {
    if (!req.tenant) throw new Error("Tenant ausente");
    return req.tenant;
  };
  const repo = (req: FastifyRequest) => forOrganization(db, tenantOf(req).organizationId, tenantOf(req).actorId);

  /**
   * El token viaja SOLO por email: así, aceptar demuestra que la persona controla
   * esa casilla (ni siquiera el ADMIN que invita lo ve). Si el email no sale, la
   * invitación se revoca para no dejar un link que nadie recibió.
   */
  app.post("/invitations", requires("members:manage"), async (req, reply) => {
    const { email, role } = InvitationBody.parse(req.body);
    const r = repo(req);
    const token = newSessionToken();
    const invitation = await r.createInvitation({
      email,
      role,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000),
    });

    const { actorId } = tenantOf(req);
    const inviter = actorId ? await getUserById(db, actorId) : null;
    const organization = await r.getOrganization();
    try {
      await mailer.send(
        invitationEmail({
          to: email,
          organizationName: organization.name,
          invitedBy: inviter?.name ?? inviter?.email ?? "Un administrador",
          role,
          url: acceptUrl(appUrl, token),
          expiresAt: invitation.expiresAt,
        }),
      );
    } catch (err) {
      req.log.error({ err }, "No se pudo enviar la invitación");
      await r.revokeInvitation(invitation.id, "email_failed");
      return reply.code(502).send({ error: "No se pudo enviar el email de invitación. Probá de nuevo en unos minutos." });
    }
    return reply.code(201).send(invitation);
  });

  app.get("/invitations", requires("members:read"), async (req) => repo(req).listInvitations());

  app.delete("/invitations/:invitationId", requires("members:manage"), async (req, reply) => {
    const { invitationId } = InvitationParams.parse(req.params);
    await repo(req).revokeInvitation(invitationId);
    return reply.code(204).send();
  });
}

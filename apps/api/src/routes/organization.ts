import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ConflictError,
  deleteAllSessionsForUser,
  disableMfa,
  forOrganization,
  getUserById,
  listMembershipsForUser,
  type Db,
} from "@cumplia/db";
import { notify, type Mailer } from "../email/mailer.js";
import { mfaResetByAdminEmail, organizationDeletedEmail } from "../email/templates.js";
import { buildOrganizationExport, exportFileName } from "../reports/organization-export.js";
import { requires } from "../security/permissions.js";
import { ReauthBody, confirmIdentity } from "../security/reauth.js";
import { SESSION_COOKIE } from "../security/session.js";
import { contentDisposition } from "../storage/files.js";
import type { ObjectStorage } from "../storage/storage.js";
import { RoleSchema } from "../tenant.js";
import { sendPasswordReset } from "./password.js";
import { OrganizationName } from "./schemas.js";

const UserParams = z.object({ userId: z.string().uuid() });
// Escribir el nombre confirma que se entiende QUÉ organización se elimina.
const DeleteOrganizationBody = ReauthBody.extend({ confirmName: z.string().trim().min(1).max(200) });
const OrganizationBody = z
  .object({
    name: OrganizationName.optional(),
    requireMfa: z.boolean().optional(),
  })
  .refine((b) => b.name !== undefined || b.requireMfa !== undefined, { message: "Nada para actualizar" });
const RoleBody = z.object({ role: RoleSchema });

interface Options {
  db: Db;
  mailer: Mailer;
  appUrl: string;
  storage?: ObjectStorage;
  encryptionKey?: Buffer;
  authRateLimit: number;
}

/** Se registra dentro de protectedRoutes: tenant y permisos ya están verificados. */
export async function organizationRoutes(
  app: FastifyInstance,
  { db, mailer, appUrl, storage, encryptionKey, authRateLimit }: Options,
) {
  // Acciones pesadas o irreversibles: además del permiso, pocas por minuto.
  const strictly = (opts: ReturnType<typeof requires>) => ({
    config: { ...opts.config, rateLimit: { max: authRateLimit, timeWindow: "1 minute" } },
  });
  const tenantOf = (req: FastifyRequest) => {
    if (!req.tenant) throw new Error("Tenant ausente");
    return req.tenant;
  };
  const repo = (req: FastifyRequest) => {
    const t = tenantOf(req);
    return forOrganization(db, t.organizationId, t.actorId);
  };

  app.get("/organization", requires("org:read"), async (req) => repo(req).getOrganization());

  app.patch("/organization", requires("org:manage"), async (req) => {
    const body = OrganizationBody.parse(req.body);
    // Quien exige MFA tiene que tenerlo: si no, se dejaría afuera a sí mismo.
    if (body.requireMfa && !tenantOf(req).mfaEnabled) {
      throw new ConflictError("Activá MFA en tu cuenta antes de exigirlo a la organización");
    }
    return repo(req).updateOrganization(body);
  });

  /**
   * Todos los datos de la organización en un ZIP (JSON + archivos de evidencia):
   * portabilidad y fin del servicio. Solo ADMIN, con email verificado; queda auditado.
   */
  app.get("/organization/export", strictly(requires("org:manage", { verifiedEmail: true })), async (req, reply) => {
    const data = await repo(req).exportData();
    if (data.files.length > 0 && !storage) {
      return reply.code(503).send({ error: "El almacenamiento de archivos no está disponible; probá más tarde" });
    }
    const zip = await buildOrganizationExport(data, (key) => storage!.get(key));
    return reply
      .header("content-type", "application/zip")
      .header("content-disposition", contentDisposition(exportFileName(data.organization.name), "attachment"))
      .header("cache-control", "private, no-store")
      .send(Buffer.from(zip));
  });

  /**
   * Elimina la organización con TODOS sus datos, archivos y auditoría (irreversible).
   * Exige escribir su nombre, la contraseña y, con MFA, un código. Avisa por email a
   * todos los miembros. Las cuentas que no pertenecen a otra organización también se
   * borran (ya no podrían ingresar); las demás siguen en sus otras organizaciones.
   */
  app.post("/organization/delete", strictly(requires("org:manage")), async (req, reply) => {
    const tenant = tenantOf(req);
    const r = repo(req);
    const body = DeleteOrganizationBody.parse(req.body);
    const organization = await r.getOrganization();
    if (body.confirmName !== organization.name.trim()) {
      return reply.code(400).send({ error: "Escribí el nombre exacto de la organización para confirmar" });
    }
    // Solo con una sesión de verdad (el encabezado de desarrollo no identifica a nadie).
    const actor = tenant.actorId ? await getUserById(db, tenant.actorId) : null;
    if (!actor || !(await confirmIdentity({ db, mailer, log: req.log, encryptionKey }, actor, body))) {
      await r.record("organization.delete_failed", "organization", tenant.organizationId);
      return reply.code(403).send({ error: "No se pudo verificar tu identidad" });
    }

    const members = await r.listMembers();
    const fileKeys = await r.listEvidenceFileKeys();
    if (fileKeys.length > 0 && !storage) {
      return reply.code(503).send({ error: "El almacenamiento de archivos no está disponible; probá más tarde" });
    }
    // Primero los archivos: si algo falla, la organización sigue entera y se puede reintentar.
    for (const key of fileKeys) await storage!.delete(key);
    const { deletedAccounts } = await r.purgeOrganization();

    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    const deletedBy = actor.name ?? actor.email;
    for (const m of members) {
      notify(
        mailer,
        req.log,
        organizationDeletedEmail({
          to: m.email,
          organizationName: organization.name,
          deletedBy,
          accountDeleted: deletedAccounts.includes(m.userId),
        }),
      );
    }
    req.log.info(
      { organizationId: tenant.organizationId, actorId: actor.id, deletedAccounts: deletedAccounts.length },
      "organización eliminada",
    );
    return reply.code(204).send();
  });

  app.get("/members", requires("members:read"), async (req) => repo(req).listMembers());

  app.patch("/members/:userId", requires("members:manage"), async (req) => {
    const { userId } = UserParams.parse(req.params);
    const { role } = RoleBody.parse(req.body);
    return repo(req).changeMemberRole(userId, role);
  });

  app.delete("/members/:userId", requires("members:manage"), async (req, reply) => {
    const { userId } = UserParams.parse(req.params);
    await repo(req).removeMember(userId);
    return reply.code(204).send();
  });

  // ---- Ayuda a un miembro con su cuenta, sin tocar nunca su contraseña ----

  /**
   * Le envía un link para que ELIJA una contraseña nueva. El ADMIN no ve ni fija la
   * clave; solo quien controla la casilla puede usarlo.
   */
  app.post("/members/:userId/password-reset", requires("members:manage"), async (req, reply) => {
    const { userId } = UserParams.parse(req.params);
    const r = repo(req);
    const member = await r.getMember(userId); // 404 si no es de esta organización
    const organization = await r.getOrganization();
    await sendPasswordReset({ db, mailer, log: req.log, appUrl }, { id: member.userId, email: member.email }, {
      userId: tenantOf(req).actorId,
      organizationName: organization.name,
    });
    await r.record("member.password_reset_sent", "user", member.userId);
    return reply.code(202).send({ message: `Le enviamos a ${member.email} un link para elegir una contraseña nueva.` });
  });

  /** Cierra sus sesiones en ESTA organización (p. ej. dispositivo perdido o sospecha). */
  app.post("/members/:userId/sessions/revoke", requires("members:manage"), async (req, reply) => {
    const { userId } = UserParams.parse(req.params);
    const r = repo(req);
    await r.getMember(userId);
    await r.revokeMemberSessions(userId);
    return reply.code(204).send();
  });

  /**
   * Restablece su MFA (perdió el teléfono y los códigos). Solo si la cuenta pertenece
   * ÚNICAMENTE a esta organización: si no, este ADMIN estaría debilitando el acceso a
   * datos de otras organizaciones. Exige que quien lo hace tenga MFA (paso extra).
   */
  app.delete("/members/:userId/mfa", requires("members:manage"), async (req, reply) => {
    const { userId } = UserParams.parse(req.params);
    const tenant = tenantOf(req);
    const r = repo(req);
    const member = await r.getMember(userId);
    if (member.userId === tenant.actorId) {
      throw new ConflictError("Tu propio MFA se gestiona desde Seguridad");
    }
    if (!tenant.mfaEnabled) {
      throw new ConflictError("Activá MFA en tu cuenta para poder restablecer el de otras personas");
    }
    if (!member.mfaEnabled) throw new ConflictError("Esa persona no tiene MFA activo");
    const memberships = await listMembershipsForUser(db, member.userId);
    if (memberships.length > 1) {
      throw new ConflictError(
        "Esta cuenta también pertenece a otras organizaciones, así que su MFA no se puede restablecer desde acá. " +
          "La persona puede entrar con un código de recuperación y reconfigurarlo desde Seguridad.",
      );
    }
    await disableMfa(db, member.userId);
    await deleteAllSessionsForUser(db, member.userId); // pertenece solo a esta organización
    await r.record("member.mfa_reset", "user", member.userId);
    const organization = await r.getOrganization();
    notify(mailer, req.log, mfaResetByAdminEmail(member.email, organization.name));
    return reply.code(204).send();
  });
}

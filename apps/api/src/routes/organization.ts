import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ConflictError, forOrganization, type Db } from "@cumplia/db";
import { requires } from "../security/permissions.js";
import { RoleSchema } from "../tenant.js";

const UserParams = z.object({ userId: z.string().uuid() });
const OrganizationBody = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    requireMfa: z.boolean().optional(),
  })
  .refine((b) => b.name !== undefined || b.requireMfa !== undefined, { message: "Nada para actualizar" });
const RoleBody = z.object({ role: RoleSchema });

interface Options {
  db: Db;
}

/** Se registra dentro de protectedRoutes: tenant y permisos ya están verificados. */
export async function organizationRoutes(app: FastifyInstance, { db }: Options) {
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
}

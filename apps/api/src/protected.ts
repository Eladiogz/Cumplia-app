import type { FastifyInstance } from "fastify";
import type { Db } from "@cumplia/db";
import { assessmentRoutes } from "./routes/assessments.js";
import { organizationRoutes } from "./routes/organization.js";
import { can } from "./security/permissions.js";
import type { TenantResolver } from "./tenant.js";

interface Options {
  db: Db;
  resolveTenant: TenantResolver;
}

/**
 * Todas las rutas por organización pasan por acá. Falla cerrado en tres niveles:
 * sin tenant → 401; organización que exige MFA y usuario sin MFA → 403;
 * rol sin el permiso que declara la ruta → 403.
 */
export async function protectedRoutes(app: FastifyInstance, { db, resolveTenant }: Options) {
  app.decorateRequest("tenant", null);

  // Una ruta sin permiso declarado no llega a existir: la app no arranca.
  app.addHook("onRoute", (route) => {
    if (!route.config?.permission) {
      throw new Error(`Ruta protegida sin permiso declarado: ${String(route.method)} ${route.url}`);
    }
  });

  app.addHook("preHandler", async (req, reply) => {
    const tenant = await resolveTenant(req);
    if (!tenant) return reply.code(401).send({ error: "No autenticado" });
    if (tenant.mfaSetupRequired) {
      return reply
        .code(403)
        .send({ error: "Tu organización exige MFA: activalo para continuar", code: "MFA_SETUP_REQUIRED" });
    }
    const permission = req.routeOptions.config.permission;
    if (!permission || !can(tenant.role, permission)) {
      return reply.code(403).send({ error: "No tenés permiso para esta acción", code: "FORBIDDEN" });
    }
    req.tenant = tenant;
  });

  app.register(assessmentRoutes, { db });
  app.register(organizationRoutes, { db });
}

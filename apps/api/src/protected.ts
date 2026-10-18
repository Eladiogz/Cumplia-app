import type { FastifyInstance } from "fastify";
import type { Db } from "@cumplia/db";
import type { Mailer } from "./email/mailer.js";
import type { ObjectStorage } from "./storage/storage.js";
import { assessmentRoutes } from "./routes/assessments.js";
import { invitationRoutes } from "./routes/invitations.js";
import { organizationRoutes } from "./routes/organization.js";
import { riskRoutes } from "./routes/risks.js";
import { can } from "./security/permissions.js";
import type { TenantResolver } from "./tenant.js";

interface Options {
  db: Db;
  resolveTenant: TenantResolver;
  mailer: Mailer;
  appUrl: string;
  storage?: ObjectStorage;
}

/**
 * Todas las rutas por organización pasan por acá. Falla cerrado en tres niveles:
 * sin tenant → 401; organización que exige MFA y usuario sin MFA → 403;
 * rol sin el permiso que declara la ruta → 403.
 */
export async function protectedRoutes(app: FastifyInstance, { db, resolveTenant, mailer, appUrl, storage }: Options) {
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
    const { permission, verifiedEmail } = req.routeOptions.config;
    if (!permission || !can(tenant.role, permission)) {
      return reply.code(403).send({ error: "No tenés permiso para esta acción", code: "FORBIDDEN" });
    }
    if (verifiedEmail && !tenant.emailVerified) {
      return reply
        .code(403)
        .send({ error: "Confirmá tu email para hacer esto (revisá tu casilla o pedí un nuevo link)", code: "EMAIL_NOT_VERIFIED" });
    }
    req.tenant = tenant;
  });

  app.register(assessmentRoutes, { db, storage });
  app.register(organizationRoutes, { db, mailer, appUrl });
  app.register(invitationRoutes, { db, mailer, appUrl });
  app.register(riskRoutes, { db });
}

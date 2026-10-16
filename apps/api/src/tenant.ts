import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { organizationExists, type Db } from "@cumplia/db";

/** Quién hace la petición y en nombre de qué organización. */
export interface Tenant {
  organizationId: string;
  actorId: string | null;
}

/** Devuelve el tenant de la petición o null si no está autenticada. */
export type TenantResolver = (req: FastifyRequest) => Promise<Tenant | null> | Tenant | null;

declare module "fastify" {
  interface FastifyRequest {
    tenant: Tenant | null;
  }
}

const Uuid = z.string().uuid();

/**
 * SOLO DESARROLLO. Toma la organización del header `x-organization-id`.
 * Cualquiera podría falsificarlo: se reemplaza por la autenticación real
 * (feat/auth-core) y server.ts no lo activa en producción.
 */
export function createDevTenantResolver(db: Db): TenantResolver {
  return async (req) => {
    const org = Uuid.safeParse(req.headers["x-organization-id"]);
    if (!org.success || !(await organizationExists(db, org.data))) return null;
    const actor = Uuid.safeParse(req.headers["x-actor-id"]);
    return { organizationId: org.data, actorId: actor.success ? actor.data : null };
  };
}

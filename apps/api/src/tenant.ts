import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { findActiveSession, organizationExists, touchSession, type Db, type Role } from "@cumplia/db";
import { SESSION_COOKIE, hashToken } from "./security/session.js";

/** Quién hace la petición y en nombre de qué organización. */
export interface Tenant {
  organizationId: string;
  actorId: string | null;
  role: Role;
  /** El usuario tiene MFA activo. */
  mfaEnabled: boolean;
  /** La organización exige MFA y el usuario todavía no lo activó: solo puede configurarlo. */
  mfaSetupRequired: boolean;
  /** Confirmó su email (algunas acciones, como invitar, lo exigen). */
  emailVerified: boolean;
}

/** Devuelve el tenant de la petición o null si no está autenticada. */
export type TenantResolver = (req: FastifyRequest) => Promise<Tenant | null> | Tenant | null;

declare module "fastify" {
  interface FastifyRequest {
    tenant: Tenant | null;
  }
}

const Uuid = z.string().uuid();
export const RoleSchema = z.enum(["ADMIN", "CONSULTANT", "AUDITOR"]);

/** Autenticación real: cookie de sesión → usuario, organización y rol vigentes. */
export function createSessionTenantResolver(db: Db): TenantResolver {
  return async (req) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return null;
    const session = await findActiveSession(db, hashToken(token));
    if (!session) return null;
    await touchSession(db, session);
    return {
      organizationId: session.organizationId,
      actorId: session.userId,
      role: session.role,
      mfaEnabled: session.userMfaEnabled,
      mfaSetupRequired: session.organizationRequiresMfa && !session.userMfaEnabled,
      emailVerified: session.userEmailVerified,
    };
  };
}

/** Prueba varios resolvers en orden; el primero que devuelva un tenant gana. */
export function firstOf(...resolvers: TenantResolver[]): TenantResolver {
  return async (req) => {
    for (const resolve of resolvers) {
      const tenant = await resolve(req);
      if (tenant) return tenant;
    }
    return null;
  };
}

/**
 * SOLO DESARROLLO. Toma la organización del header `x-organization-id`.
 * Cualquiera podría falsificarlo: server.ts no lo activa en producción.
 * Actúa como ADMIN salvo que `x-role` indique otro rol.
 */
export function createDevTenantResolver(db: Db): TenantResolver {
  return async (req) => {
    const org = Uuid.safeParse(req.headers["x-organization-id"]);
    if (!org.success || !(await organizationExists(db, org.data))) return null;
    const actor = Uuid.safeParse(req.headers["x-actor-id"]);
    const role = RoleSchema.safeParse(req.headers["x-role"]);
    return {
      organizationId: org.data,
      actorId: actor.success ? actor.data : null,
      role: role.success ? role.data : "ADMIN",
      mfaEnabled: false,
      mfaSetupRequired: false,
      emailVerified: true,
    };
  };
}

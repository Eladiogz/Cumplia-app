import type { Role } from "@cumplia/db";

export type Permission =
  | "org:read"
  | "org:manage"
  | "members:read"
  | "members:manage"
  | "assessment:read"
  | "assessment:write"
  | "audit:read";

/**
 * Única fuente de verdad de qué puede hacer cada rol. Lo que no figura, se deniega.
 * - ADMIN: todo.
 * - CONSULTANT: trabaja las evaluaciones (respuestas, evidencia); no administra.
 * - AUDITOR: solo lectura, incluida la auditoría y la revisión de accesos (ISO A.5.18).
 */
const MATRIX: Record<Role, readonly Permission[]> = {
  ADMIN: ["org:read", "org:manage", "members:read", "members:manage", "assessment:read", "assessment:write", "audit:read"],
  CONSULTANT: ["org:read", "assessment:read", "assessment:write"],
  AUDITOR: ["org:read", "members:read", "assessment:read", "audit:read"],
};

export const can = (role: Role, permission: Permission) => MATRIX[role].includes(permission);

/**
 * Opciones de ruta: `app.get(url, requires("assessment:read"), handler)`.
 * `verifiedEmail`: además exige que la persona haya confirmado su email.
 */
export const requires = (permission: Permission, { verifiedEmail = false } = {}) => ({
  config: { permission, verifiedEmail },
});

declare module "fastify" {
  interface FastifyContextConfig {
    /** Permiso que exige la ruta. Toda ruta protegida DEBE declararlo (ver protected.ts). */
    permission?: Permission;
    /** La ruta exige email verificado (p. ej. invitar a otras personas). */
    verifiedEmail?: boolean;
  }
}

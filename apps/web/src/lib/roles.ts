import type { Role } from "./types";

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Administrador/a",
  CONSULTANT: "Consultor/a",
  AUDITOR: "Auditor/a",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  ADMIN: "Administra la organización, sus miembros y todas las evaluaciones.",
  CONSULTANT: "Trabaja las evaluaciones: respuestas y evidencia.",
  AUDITOR: "Solo lectura, incluida la auditoría y la revisión de accesos.",
};

// Espejo de la matriz de la API, solo para mostrar u ocultar controles.
// La API es la que decide: esconder un botón no es seguridad.
export const canManageMembers = (role: Role) => role === "ADMIN";
export const canSeeMembers = (role: Role) => role === "ADMIN" || role === "AUDITOR";
export const canEditAssessments = (role: Role) => role === "ADMIN" || role === "CONSULTANT";

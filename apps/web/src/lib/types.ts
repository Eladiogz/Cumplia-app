// Formas de las respuestas de la API que usa la web.

export type Role = "ADMIN" | "CONSULTANT" | "AUDITOR";

export interface User {
  id: string;
  email: string;
  name: string | null;
}

export interface Me {
  user: User;
  organizationId: string;
  role: Role;
  mfaEnabled: boolean;
  mfaSetupRequired: boolean;
  emailVerified: boolean;
}

export interface OrganizationMembership {
  organizationId: string;
  organizationName: string;
  role: Role;
  requireMfa: boolean;
  active: boolean;
}

export interface Organization {
  id: string;
  name: string;
  requireMfa: boolean;
}

export interface Member {
  userId: string;
  email: string;
  name: string | null;
  role: Role;
  mfaEnabled: boolean;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  expiresAt: string;
}

export interface InvitationPreview {
  organizationName: string;
  email: string;
  role: Role;
  expiresAt: string;
}

export interface Assessment {
  id: string;
  frameworkId: string;
  targetMaturity: number;
  createdAt: string;
}

/** Respuesta de login/registro/verificación cuando ya hay sesión. */
export interface SessionStart {
  user: User;
  organization: { id: string; name: string };
  role: Role;
  recoveryCodesRemaining?: number;
}

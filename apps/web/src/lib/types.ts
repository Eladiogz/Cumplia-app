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
  name: string;
  frameworkId: string;
  targetMaturity: number;
  createdAt: string;
  updatedAt: string;
}

/** Elemento del listado: con el avance. */
export interface AssessmentSummary extends Assessment {
  answered: number;
  total: number;
}

export interface Control {
  id: string;
  domain: string;
  title: string;
}

export interface Framework {
  id: string;
  name: string;
  version: string;
  domains: Record<string, string>;
  controls: Control[];
}

export interface Answer {
  controlId: string;
  applicable: boolean;
  maturity?: number | null;
  justification?: string;
}

export interface DomainScore {
  domain: string;
  label: string;
  applicable: number;
  assessed: number;
  score: number;
  average: number | null;
  meetingTarget: number;
}

export interface Gap {
  controlId: string;
  title: string;
  domain: string;
  maturity: number;
  target: number;
  gap: number;
}

export interface AssessmentResult {
  frameworkId: string;
  targetMaturity: number;
  overallScore: number;
  averageMaturity: number | null;
  coverage: number;
  applicable: number;
  notApplicable: number;
  pending: number;
  meetingTarget: number;
  distribution: [number, number, number, number, number];
  byDomain: DomainScore[];
  gaps: Gap[];
}

export interface Evidence {
  id: string;
  controlId: string;
  source: string;
  description: string;
  collectedAt: string;
  /** Solo si tiene archivo adjunto. */
  fileName: string | null;
  fileSize: number | null;
  contentType: string | null;
  sha256: string | null;
}

/** Respuesta de login/registro/verificación cuando ya hay sesión. */
export interface SessionStart {
  user: User;
  organization: { id: string; name: string };
  role: Role;
  recoveryCodesRemaining?: number;
}

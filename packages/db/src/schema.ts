import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Modelo multi-tenant. Toda tabla de negocio lleva `organization_id` (aunque
 * sea redundante) y el código SIEMPRE filtra por él: defensa en profundidad.
 * Además, las relaciones padre-hijo usan FK compuestas (id, organization_id):
 * la base rechaza cualquier fila que mezcle datos de dos organizaciones.
 */
export type AuditDetails = Record<string, string | number | boolean | null>;

export const roleEnum = pgEnum("role", ["ADMIN", "CONSULTANT", "AUDITOR"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Política: todos los miembros deben tener MFA activo para operar.
  requireMfa: boolean("require_mfa").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  // Nulo = sin contraseña local (p. ej. futuro SSO): no puede iniciar sesión con clave.
  passwordHash: text("password_hash"),
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  // Secreto TOTP cifrado (AES-256-GCM) con una clave que NO está en la base.
  // Con secreto y sin fecha de activación = configuración pendiente de confirmar.
  mfaSecret: text("mfa_secret"),
  mfaEnabledAt: timestamp("mfa_enabled_at", { withTimezone: true }),
  // Último paso de tiempo TOTP aceptado: impide reutilizar un código ya usado.
  mfaLastUsedStep: integer("mfa_last_used_step"),
  // Organización de la última sesión: el próximo login vuelve a ella si sigue siendo miembro.
  lastOrganizationId: uuid("last_organization_id").references(() => organizations.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    role: roleEnum("role").notNull(),
  },
  (t) => [unique("memberships_user_org_uq").on(t.userId, t.organizationId)],
);

export const mfaRecoveryCodes = pgTable(
  "mfa_recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // Solo el hash: los códigos se muestran una única vez al activar MFA.
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [unique("mfa_recovery_codes_user_code_uq").on(t.userId, t.codeHash)],
);

/**
 * Segundo paso del inicio de sesión: la contraseña ya fue correcta y falta el código.
 * Tabla aparte de `sessions` a propósito: un desafío jamás puede usarse como sesión.
 */
export const mfaChallenges = pgTable(
  "mfa_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    tokenHash: text("token_hash").notNull().unique(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("mfa_challenges_user_idx").on(t.userId),
    foreignKey({
      name: "mfa_challenges_membership_fk",
      columns: [t.userId, t.organizationId],
      foreignColumns: [memberships.userId, memberships.organizationId],
    }).onDelete("cascade"),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    // Solo se guarda el hash del token: una filtración de la base no permite secuestrar sesiones.
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("sessions_user_idx").on(t.userId),
    // Solo puede haber sesión donde hay membresía; quitar al miembro borra sus sesiones.
    foreignKey({
      name: "sessions_membership_fk",
      columns: [t.userId, t.organizationId],
      foreignColumns: [memberships.userId, memberships.organizationId],
    }).onDelete("cascade"),
  ],
);

export const assessments = pgTable(
  "assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    frameworkId: text("framework_id").notNull(),
    targetMaturity: integer("target_maturity").notNull().default(3),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Destino de las FK compuestas (id, organization_id) de las tablas hijas.
    unique("assessments_id_org_uq").on(t.id, t.organizationId),
    index("assessments_org_idx").on(t.organizationId),
    check("assessments_target_range", sql`${t.targetMaturity} between 1 and 4`),
  ],
);

export const controlAnswers = pgTable(
  "control_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    assessmentId: uuid("assessment_id").notNull(),
    controlId: text("control_id").notNull(),
    applicable: boolean("applicable").notNull().default(true),
    maturity: integer("maturity"),
    justification: text("justification"),
  },
  (t) => [
    // La respuesta y su evaluación son SIEMPRE de la misma organización (lo garantiza la base).
    foreignKey({
      name: "control_answers_assessment_org_fk",
      columns: [t.assessmentId, t.organizationId],
      foreignColumns: [assessments.id, assessments.organizationId],
    }).onDelete("cascade"),
    unique("control_answers_id_org_uq").on(t.id, t.organizationId),
    unique("control_answers_assessment_control_uq").on(t.assessmentId, t.controlId),
    index("control_answers_org_idx").on(t.organizationId),
    check("control_answers_maturity_range", sql`${t.maturity} is null or ${t.maturity} between 0 and 4`),
  ],
);

export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    controlAnswerId: uuid("control_answer_id").notNull(),
    source: text("source").notNull(), // manual, m365, github...
    description: text("description").notNull(),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "evidence_control_answer_org_fk",
      columns: [t.controlAnswerId, t.organizationId],
      foreignColumns: [controlAnswers.id, controlAnswers.organizationId],
    }).onDelete("cascade"),
    index("evidence_org_idx").on(t.organizationId),
  ],
);

/**
 * Invitación a sumarse a una organización con un rol. El token viaja una sola vez
 * (link) y aquí solo queda su hash. Protegida por RLS como el resto de los datos
 * de la organización; quien acepta la lee presentando el hash del token (ver 0007).
 */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    email: text("email").notNull(),
    role: roleEnum("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => users.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("invitations_org_idx").on(t.organizationId)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    // Contexto del evento (p. ej. rol anterior y nuevo). Nunca secretos ni tokens.
    details: jsonb("details").$type<AuditDetails>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt)],
);

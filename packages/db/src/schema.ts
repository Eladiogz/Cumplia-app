import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
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
 */
export const roleEnum = pgEnum("role", ["ADMIN", "CONSULTANT", "AUDITOR"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
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
    index("assessments_org_idx").on(t.organizationId),
    check("assessments_target_range", sql`${t.targetMaturity} between 1 and 4`),
  ],
);

export const controlAnswers = pgTable(
  "control_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),
    controlId: text("control_id").notNull(),
    applicable: boolean("applicable").notNull().default(true),
    maturity: integer("maturity"),
    justification: text("justification"),
  },
  (t) => [
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
    controlAnswerId: uuid("control_answer_id")
      .notNull()
      .references(() => controlAnswers.id, { onDelete: "cascade" }),
    source: text("source").notNull(), // manual, m365, github...
    description: text("description").notNull(),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("evidence_org_idx").on(t.organizationId)],
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt)],
);

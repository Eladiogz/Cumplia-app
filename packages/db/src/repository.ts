import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { AnswerSchema, scoreAssessment, type Answer, type AssessmentResult } from "@cumplia/core";
import { loadFramework } from "@cumplia/frameworks";
import type { Role } from "./auth.js";
import type { Db } from "./client.js";
import {
  assessments,
  auditLogs,
  controlAnswers,
  evidence,
  invitations,
  memberships,
  mfaChallenges,
  organizations,
  sessions,
  users,
  type AuditDetails,
} from "./schema.js";

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} no encontrado`);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export async function organizationExists(db: Db, organizationId: string) {
  const [row] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return row !== undefined;
}

export async function createOrganization(db: Db, name: string) {
  const [org] = await db.insert(organizations).values({ name }).returning();
  if (!org) throw new Error("No se pudo crear la organización");
  return org;
}

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Ni aceptada ni revocada (el vencimiento se controla aparte). */
export const pending = and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt));

/** Columnas de una invitación que se pueden mostrar: nunca el hash del token. */
export const invitationPublicColumns = {
  id: invitations.id,
  email: invitations.email,
  role: invitations.role,
  createdAt: invitations.createdAt,
  expiresAt: invitations.expiresAt,
};

/**
 * Fija la organización activa para Row-Level Security, solo dentro de esta
 * transacción (`set_config(..., true)`): con un pool de conexiones no se filtra
 * a la petición siguiente. Sin este valor, las políticas no devuelven filas.
 */
export async function setTenantContext(tx: Tx, organizationId: string) {
  await tx.execute(sql`select set_config('app.organization_id', ${organizationId}, true)`);
}

/**
 * Único punto de acceso a datos de negocio. Recibe la organización UNA vez y
 * cada consulta la aplica; no existe forma de leer o escribir fuera de ella.
 * Doble barrera: cada consulta filtra por organización Y corre en una transacción
 * con el contexto de RLS, así que la base tampoco devolvería filas ajenas.
 * Cada cambio deja un registro de auditoría en la misma transacción.
 */
export function forOrganization(db: Db, organizationId: string, actorId: string | null = null) {
  const inTenant = <T>(fn: (tx: Tx) => Promise<T>) =>
    db.transaction(async (tx) => {
      await setTenantContext(tx, organizationId);
      return fn(tx);
    });

  const audit = (tx: Tx, action: string, entity: string, entityId: string | null, details?: AuditDetails) =>
    tx.insert(auditLogs).values({ organizationId, actorId, action, entity, entityId, details: details ?? null });

  const answersOf = async (tx: Tx, assessmentId: string): Promise<Answer[]> => {
    const rows = await tx
      .select()
      .from(controlAnswers)
      .where(and(eq(controlAnswers.assessmentId, assessmentId), eq(controlAnswers.organizationId, organizationId)));
    return rows.map((r) => ({
      controlId: r.controlId,
      applicable: r.applicable,
      maturity: r.maturity ?? undefined,
      justification: r.justification ?? undefined,
    }));
  };

  const ownedAssessment = async (tx: Tx, assessmentId: string) => {
    const [row] = await tx
      .select()
      .from(assessments)
      .where(and(eq(assessments.id, assessmentId), eq(assessments.organizationId, organizationId)));
    return row ?? null;
  };

  return {
    async createAssessment(frameworkId: string, targetMaturity = 3) {
      try {
        loadFramework(frameworkId); // valida que exista
      } catch {
        throw new ValidationError(`Marco normativo desconocido: ${frameworkId}`);
      }
      return inTenant(async (tx) => {
        const [a] = await tx
          .insert(assessments)
          .values({ organizationId, frameworkId, targetMaturity })
          .returning();
        if (!a) throw new Error("No se pudo crear la evaluación");
        await audit(tx, "assessment.create", "assessment", a.id);
        return a;
      });
    },

    listAssessments() {
      return inTenant((tx) =>
        tx
          .select()
          .from(assessments)
          .where(eq(assessments.organizationId, organizationId))
          .orderBy(desc(assessments.createdAt)),
      );
    },

    getAssessment(assessmentId: string) {
      return inTenant((tx) => ownedAssessment(tx, assessmentId));
    },

    async saveAnswers(assessmentId: string, rawAnswers: Answer[]) {
      const answers = rawAnswers.map((a) => AnswerSchema.parse(a));
      const framework = (id: string) => loadFramework(id);
      return inTenant(async (tx) => {
        const assessment = await ownedAssessment(tx, assessmentId);
        if (!assessment) throw new NotFoundError("Evaluación");
        const valid = new Set(framework(assessment.frameworkId).controls.map((c) => c.id));
        for (const a of answers) {
          if (!valid.has(a.controlId)) throw new ValidationError(`Control inexistente: ${a.controlId}`);
          const values = {
            organizationId,
            assessmentId,
            controlId: a.controlId,
            applicable: a.applicable,
            maturity: a.applicable ? (a.maturity ?? null) : null,
            justification: a.justification ?? null,
          };
          await tx
            .insert(controlAnswers)
            .values(values)
            .onConflictDoUpdate({
              target: [controlAnswers.assessmentId, controlAnswers.controlId],
              set: { applicable: values.applicable, maturity: values.maturity, justification: values.justification },
              setWhere: eq(controlAnswers.organizationId, organizationId),
            });
        }
        await audit(tx, "answers.save", "assessment", assessmentId);
        return answers.length;
      });
    },

    getAnswers(assessmentId: string): Promise<Answer[]> {
      return inTenant((tx) => answersOf(tx, assessmentId));
    },

    computeResult(assessmentId: string): Promise<AssessmentResult> {
      return inTenant(async (tx) => {
        const assessment = await ownedAssessment(tx, assessmentId);
        if (!assessment) throw new NotFoundError("Evaluación");
        const answers = await answersOf(tx, assessmentId);
        return scoreAssessment(loadFramework(assessment.frameworkId), answers, assessment.targetMaturity);
      });
    },

    async addEvidence(assessmentId: string, controlId: string, source: string, description: string) {
      return inTenant(async (tx) => {
        const [answer] = await tx
          .select()
          .from(controlAnswers)
          .where(
            and(
              eq(controlAnswers.assessmentId, assessmentId),
              eq(controlAnswers.controlId, controlId),
              eq(controlAnswers.organizationId, organizationId),
            ),
          );
        if (!answer) throw new NotFoundError("Respuesta de control");
        const [ev] = await tx
          .insert(evidence)
          .values({ organizationId, controlAnswerId: answer.id, source, description })
          .returning();
        if (!ev) throw new Error("No se pudo guardar la evidencia");
        await audit(tx, "evidence.add", "evidence", ev.id);
        return ev;
      });
    },

    /** Registra un evento de auditoría propio (inicio de sesión, cierre, etc.). */
    async record(action: string, entity: string, entityId: string | null = null, details?: AuditDetails) {
      await inTenant((tx) => audit(tx, action, entity, entityId, details));
    },

    listAuditLog(limit = 50) {
      return inTenant((tx) =>
        tx
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.organizationId, organizationId))
          .orderBy(desc(auditLogs.createdAt))
          .limit(limit),
      );
    },

    async getOrganization() {
      const [org] = await db
        .select({ id: organizations.id, name: organizations.name, requireMfa: organizations.requireMfa })
        .from(organizations)
        .where(eq(organizations.id, organizationId));
      if (!org) throw new NotFoundError("Organización");
      return org;
    },

    async updateOrganization(changes: { name?: string; requireMfa?: boolean }) {
      return inTenant(async (tx) => {
        const [org] = await tx
          .update(organizations)
          .set(changes)
          .where(eq(organizations.id, organizationId))
          .returning({ id: organizations.id, name: organizations.name, requireMfa: organizations.requireMfa });
        if (!org) throw new NotFoundError("Organización");
        await audit(tx, "organization.update", "organization", organizationId, {
          ...(changes.name !== undefined ? { name: changes.name } : {}),
          ...(changes.requireMfa !== undefined ? { requireMfa: changes.requireMfa } : {}),
        });
        return org;
      });
    },

    listMembers() {
      return db
        .select({
          userId: users.id,
          email: users.email,
          name: users.name,
          role: memberships.role,
          mfaEnabled: sql<boolean>`${users.mfaEnabledAt} is not null`,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.organizationId, organizationId))
        .orderBy(asc(users.email));
    },

    /** Un miembro de ESTA organización (si no lo es, NotFound: no se revela si la cuenta existe). */
    async getMember(userId: string) {
      const [member] = await db
        .select({
          userId: users.id,
          email: users.email,
          name: users.name,
          role: memberships.role,
          mfaEnabled: sql<boolean>`${users.mfaEnabledAt} is not null`,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)));
      if (!member) throw new NotFoundError("Miembro");
      return member;
    },

    /** Cierra las sesiones del miembro SOLO en esta organización (las de otras no son asunto suyo). */
    async revokeMemberSessions(userId: string) {
      await inTenant(async (tx) => {
        const closed = await tx
          .delete(sessions)
          .where(and(eq(sessions.userId, userId), eq(sessions.organizationId, organizationId)))
          .returning({ id: sessions.id });
        await tx
          .delete(mfaChallenges)
          .where(and(eq(mfaChallenges.userId, userId), eq(mfaChallenges.organizationId, organizationId)));
        await audit(tx, "member.sessions_revoked", "user", userId, { sessions: closed.length });
      });
    },

    /** Cambia el rol. Nunca deja a la organización sin ADMIN. */
    async changeMemberRole(userId: string, role: Role) {
      return inTenant(async (tx) => {
        const member = await lockMemberAndAdmins(tx, userId);
        if (member.role === "ADMIN" && role !== "ADMIN") await assertAnotherAdmin(tx, userId);
        await tx
          .update(memberships)
          .set({ role })
          .where(and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId)));
        await audit(tx, "member.role_change", "user", userId, { from: member.role, to: role });
        return { userId, role };
      });
    },

    /**
     * Quita al usuario de la organización. Sus sesiones y desafíos MFA en ella se
     * borran en cascada (FK a la membresía). Nunca deja a la organización sin ADMIN.
     */
    async removeMember(userId: string) {
      await inTenant(async (tx) => {
        const member = await lockMemberAndAdmins(tx, userId);
        if (member.role === "ADMIN") await assertAnotherAdmin(tx, userId);
        await tx
          .delete(memberships)
          .where(and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId)));
        await audit(tx, "member.remove", "user", userId, { role: member.role });
      });
    },

    /**
     * Crea una invitación. Si el email ya tenía una pendiente, la reemplaza (la
     * anterior queda revocada). Falla si la persona ya es miembro.
     */
    async createInvitation(input: { email: string; role: Role; tokenHash: string; expiresAt: Date }) {
      return inTenant(async (tx) => {
        const [already] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(and(eq(memberships.organizationId, organizationId), eq(users.email, input.email)));
        if (already) throw new ConflictError("Esa persona ya es miembro de la organización");

        await tx
          .update(invitations)
          .set({ revokedAt: sql`now()` })
          .where(and(eq(invitations.organizationId, organizationId), eq(invitations.email, input.email), pending));
        const [inv] = await tx
          .insert(invitations)
          .values({ organizationId, invitedBy: actorId, ...input })
          .returning(invitationPublicColumns);
        if (!inv) throw new Error("No se pudo crear la invitación");
        await audit(tx, "invitation.create", "invitation", inv.id, { email: inv.email, role: inv.role });
        return inv;
      });
    },

    /** Invitaciones pendientes y vigentes (nunca devuelve el hash del token). */
    listInvitations() {
      return inTenant((tx) =>
        tx
          .select(invitationPublicColumns)
          .from(invitations)
          .where(and(eq(invitations.organizationId, organizationId), pending, gt(invitations.expiresAt, sql`now()`)))
          .orderBy(desc(invitations.createdAt)),
      );
    },

    async revokeInvitation(invitationId: string, reason?: string) {
      await inTenant(async (tx) => {
        const rows = await tx
          .update(invitations)
          .set({ revokedAt: sql`now()` })
          .where(and(eq(invitations.id, invitationId), eq(invitations.organizationId, organizationId), pending))
          .returning({ email: invitations.email, role: invitations.role });
        const [revoked] = rows;
        if (!revoked) throw new NotFoundError("Invitación");
        await audit(tx, "invitation.revoke", "invitation", invitationId, {
          email: revoked.email,
          role: revoked.role,
          ...(reason ? { reason } : {}),
        });
      });
    },
  };

  /**
   * Bloquea las filas de ADMIN de la organización y la del miembro: dos cambios
   * simultáneos (p. ej. dos ADMIN quitándose entre sí) se serializan.
   */
  async function lockMemberAndAdmins(tx: Tx, userId: string) {
    await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.role, "ADMIN")))
      .for("update");
    const [member] = await tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId)))
      .for("update");
    if (!member) throw new NotFoundError("Miembro");
    return member;
  }

  async function assertAnotherAdmin(tx: Tx, exceptUserId: string) {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.role, "ADMIN"),
          sql`${memberships.userId} <> ${exceptUserId}`,
        ),
      );
    if (!row || row.n === 0) throw new ConflictError("La organización debe tener al menos un ADMIN");
  }
}

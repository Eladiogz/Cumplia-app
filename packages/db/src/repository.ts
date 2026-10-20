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
  risks,
  sessions,
  users,
  type AuditDetails,
} from "./schema.js";

import { ConflictError, NotFoundError, ValidationError } from "./errors.js";
import { riskMethods } from "./risks.js";

export { ConflictError, NotFoundError, ValidationError };

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

/** En una exportación, organization_id es redundante (todo es de la misma organización). */
function withoutOrganizationId<T extends { organizationId: string }>(row: T): Omit<T, "organizationId"> {
  const copy: Partial<T> = { ...row };
  delete copy.organizationId;
  return copy as Omit<T, "organizationId">;
}

/** Archivo de una evidencia, ya guardado en el almacenamiento por la API. */
export interface EvidenceFile {
  id: string;
  key: string;
  name: string;
  size: number;
  contentType: string;
  sha256: string;
}

/** Columnas de una evidencia que se pueden mostrar: nunca la clave interna del archivo. */
const evidencePublicColumns = {
  id: evidence.id,
  source: evidence.source,
  description: evidence.description,
  fileName: evidence.fileName,
  fileSize: evidence.fileSize,
  contentType: evidence.contentType,
  sha256: evidence.sha256,
  collectedAt: evidence.collectedAt,
};

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

  /** Marca la evaluación como modificada ahora. */
  const touch = (tx: Tx, assessmentId: string) =>
    tx
      .update(assessments)
      .set({ updatedAt: sql`now()` })
      .where(and(eq(assessments.id, assessmentId), eq(assessments.organizationId, organizationId)));

  const ownedAssessment = async (tx: Tx, assessmentId: string) => {
    const [row] = await tx
      .select()
      .from(assessments)
      .where(and(eq(assessments.id, assessmentId), eq(assessments.organizationId, organizationId)));
    return row ?? null;
  };

  return {
    ...riskMethods({ organizationId, inTenant, audit }),

    async createAssessment(frameworkId: string, targetMaturity = 3, name?: string) {
      try {
        loadFramework(frameworkId); // valida que exista
      } catch {
        throw new ValidationError(`Marco normativo desconocido: ${frameworkId}`);
      }
      return inTenant(async (tx) => {
        const [a] = await tx
          .insert(assessments)
          .values({ organizationId, frameworkId, targetMaturity, ...(name ? { name } : {}) })
          .returning();
        if (!a) throw new Error("No se pudo crear la evaluación");
        await audit(tx, "assessment.create", "assessment", a.id, { name: a.name, frameworkId });
        return a;
      });
    },

    /** Evaluaciones con su avance: controles ya resueltos (no aplica, o con madurez). */
    listAssessments() {
      return inTenant((tx) =>
        tx
          .select({
            id: assessments.id,
            name: assessments.name,
            frameworkId: assessments.frameworkId,
            targetMaturity: assessments.targetMaturity,
            createdAt: assessments.createdAt,
            updatedAt: assessments.updatedAt,
            // Alias explícitos: dentro de la subconsulta, "id" a secas sería el de control_answers.
            answered: sql<number>`(
              select count(*)::int from control_answers ca
              where ca.assessment_id = "assessments"."id"
                and ca.organization_id = ${organizationId}
                and (ca.applicable = false or ca.maturity is not null)
            )`,
          })
          .from(assessments)
          .where(eq(assessments.organizationId, organizationId))
          .orderBy(desc(assessments.updatedAt)),
      );
    },

    /** Cambia nombre u objetivo de madurez. */
    async updateAssessment(assessmentId: string, changes: { name?: string; targetMaturity?: number }) {
      return inTenant(async (tx) => {
        const [a] = await tx
          .update(assessments)
          .set({ ...changes, updatedAt: sql`now()` })
          .where(and(eq(assessments.id, assessmentId), eq(assessments.organizationId, organizationId)))
          .returning();
        if (!a) throw new NotFoundError("Evaluación");
        await audit(tx, "assessment.update", "assessment", assessmentId, changes);
        return a;
      });
    },

    /** Evidencia registrada en la evaluación, con el control al que pertenece. */
    async listEvidence(assessmentId: string) {
      return inTenant(async (tx) => {
        if (!(await ownedAssessment(tx, assessmentId))) throw new NotFoundError("Evaluación");
        return tx
          .select({ ...evidencePublicColumns, controlId: controlAnswers.controlId })
          .from(evidence)
          .innerJoin(controlAnswers, eq(controlAnswers.id, evidence.controlAnswerId))
          .where(and(eq(controlAnswers.assessmentId, assessmentId), eq(evidence.organizationId, organizationId)))
          .orderBy(asc(evidence.collectedAt));
      });
    },

    /** Datos para descargar el archivo de una evidencia de ESTA organización y evaluación. */
    async getEvidenceFile(assessmentId: string, evidenceId: string) {
      return inTenant(async (tx) => {
        const [row] = await tx
          .select({ fileKey: evidence.fileKey, fileName: evidence.fileName, contentType: evidence.contentType })
          .from(evidence)
          .innerJoin(controlAnswers, eq(controlAnswers.id, evidence.controlAnswerId))
          .where(
            and(
              eq(evidence.id, evidenceId),
              eq(evidence.organizationId, organizationId),
              eq(controlAnswers.assessmentId, assessmentId),
            ),
          );
        if (!row?.fileKey || !row.fileName || !row.contentType) throw new NotFoundError("Archivo");
        return { fileKey: row.fileKey, fileName: row.fileName, contentType: row.contentType };
      });
    },

    /** Borra una evidencia (queda en la auditoría). Devuelve la clave del archivo para borrarlo del almacenamiento. */
    async deleteEvidence(assessmentId: string, evidenceId: string) {
      return inTenant(async (tx) => {
        const [row] = await tx
          .select({ id: evidence.id, fileKey: evidence.fileKey, fileName: evidence.fileName, sha256: evidence.sha256, controlId: controlAnswers.controlId })
          .from(evidence)
          .innerJoin(controlAnswers, eq(controlAnswers.id, evidence.controlAnswerId))
          .where(
            and(
              eq(evidence.id, evidenceId),
              eq(evidence.organizationId, organizationId),
              eq(controlAnswers.assessmentId, assessmentId),
            ),
          );
        if (!row) throw new NotFoundError("Evidencia");
        await tx.delete(evidence).where(and(eq(evidence.id, evidenceId), eq(evidence.organizationId, organizationId)));
        await touch(tx, assessmentId);
        await audit(tx, "evidence.delete", "evidence", evidenceId, {
          controlId: row.controlId,
          ...(row.fileName ? { fileName: row.fileName, sha256: row.sha256 } : {}),
        });
        return { fileKey: row.fileKey };
      });
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
        await touch(tx, assessmentId);
        await audit(tx, "answers.save", "assessment", assessmentId, {
          controls: answers.map((a) => a.controlId).slice(0, 20).join(", "),
          count: answers.length,
        });
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

    async addEvidence(assessmentId: string, controlId: string, source: string, description: string, file?: EvidenceFile) {
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
          .values({
            organizationId,
            controlAnswerId: answer.id,
            source,
            description,
            ...(file
              ? {
                  id: file.id,
                  fileKey: file.key,
                  fileName: file.name,
                  fileSize: file.size,
                  contentType: file.contentType,
                  sha256: file.sha256,
                }
              : {}),
          })
          .returning(evidencePublicColumns);
        if (!ev) throw new Error("No se pudo guardar la evidencia");
        await touch(tx, assessmentId);
        await audit(tx, "evidence.add", "evidence", ev.id, {
          controlId,
          ...(file ? { fileName: file.name, sha256: file.sha256 } : {}),
        });
        return { ...ev, controlId };
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

    /** Invitaciones creadas por la organización en los últimos `minutes` (para limitar envíos). */
    async countRecentInvitations(minutes: number) {
      const [row] = await inTenant((tx) =>
        tx
          .select({ n: sql<number>`count(*)::int` })
          .from(invitations)
          .where(
            and(
              eq(invitations.organizationId, organizationId),
              gt(invitations.createdAt, sql`now() - make_interval(mins => ${minutes})`),
            ),
          ),
      );
      return row?.n ?? 0;
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

    /**
     * TODOS los datos de la organización, para entregárselos (portabilidad, fin del
     * servicio). Nunca hashes de tokens ni secretos. Las claves de los archivos van
     * aparte (`files`) para que la API los lea del almacenamiento.
     */
    async exportData() {
      return inTenant(async (tx) => {
        const [organization] = await tx
          .select({ id: organizations.id, name: organizations.name, requireMfa: organizations.requireMfa, createdAt: organizations.createdAt })
          .from(organizations)
          .where(eq(organizations.id, organizationId));
        if (!organization) throw new NotFoundError("Organización");
        const members = await tx
          .select({ userId: users.id, email: users.email, name: users.name, role: memberships.role })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(eq(memberships.organizationId, organizationId))
          .orderBy(asc(users.email));
        const invitationRows = await tx
          .select({ ...invitationPublicColumns, acceptedAt: invitations.acceptedAt, revokedAt: invitations.revokedAt })
          .from(invitations)
          .where(eq(invitations.organizationId, organizationId))
          .orderBy(asc(invitations.createdAt));
        const assessmentRows = await tx
          .select()
          .from(assessments)
          .where(eq(assessments.organizationId, organizationId))
          .orderBy(asc(assessments.createdAt));
        const answerRows = await tx
          .select()
          .from(controlAnswers)
          .where(eq(controlAnswers.organizationId, organizationId))
          .orderBy(asc(controlAnswers.controlId));
        const evidenceRows = await tx
          .select({ ...evidencePublicColumns, fileKey: evidence.fileKey, controlAnswerId: evidence.controlAnswerId })
          .from(evidence)
          .where(eq(evidence.organizationId, organizationId))
          .orderBy(asc(evidence.collectedAt));
        const riskRows = await tx.select().from(risks).where(eq(risks.organizationId, organizationId)).orderBy(asc(risks.number));
        const auditRows = await tx
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.organizationId, organizationId))
          .orderBy(asc(auditLogs.createdAt));

        const files: { evidenceId: string; key: string; fileName: string; assessmentId: string }[] = [];
        const exportedAssessments = assessmentRows.map((a) => ({
          ...withoutOrganizationId(a),
          answers: answerRows
            .filter((ans) => ans.assessmentId === a.id)
            .map((ans) => ({
              controlId: ans.controlId,
              applicable: ans.applicable,
              maturity: ans.maturity,
              justification: ans.justification,
              evidence: evidenceRows
                .filter((e) => e.controlAnswerId === ans.id)
                .map((e) => {
                  if (e.fileKey && e.fileName) files.push({ evidenceId: e.id, key: e.fileKey, fileName: e.fileName, assessmentId: a.id });
                  return {
                    id: e.id,
                    source: e.source,
                    description: e.description,
                    fileName: e.fileName,
                    fileSize: e.fileSize,
                    contentType: e.contentType,
                    sha256: e.sha256,
                    collectedAt: e.collectedAt,
                  };
                }),
            })),
        }));

        await audit(tx, "organization.exported", "organization", organizationId, {
          assessments: assessmentRows.length,
          risks: riskRows.length,
          files: files.length,
        });
        return {
          organization,
          members,
          invitations: invitationRows,
          assessments: exportedAssessments,
          risks: riskRows.map(withoutOrganizationId),
          auditLog: auditRows.map(withoutOrganizationId),
          files,
        };
      });
    },

    /** Claves de todos los archivos de evidencia (para borrarlos del almacenamiento). */
    listEvidenceFileKeys() {
      return inTenant(async (tx) => {
        const rows = await tx
          .select({ key: evidence.fileKey })
          .from(evidence)
          .where(and(eq(evidence.organizationId, organizationId), sql`${evidence.fileKey} is not null`));
        return rows.map((r) => r.key!);
      });
    },

    /**
     * Elimina la organización con todos sus datos y su auditoría (irreversible). Lo
     * hace la función app_purge_organization de la base, que además verifica que sea
     * la organización fijada en la transacción. Devuelve las cuentas que también se
     * borraron por no pertenecer a ninguna otra organización.
     */
    async purgeOrganization() {
      const res = (await inTenant((tx) =>
        tx.execute(sql`select app_purge_organization(${organizationId}::uuid, ${actorId}::uuid) as id`),
      )) as unknown as { rows: { id: string }[] };
      return { deletedAccounts: res.rows.map((r) => r.id) };
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

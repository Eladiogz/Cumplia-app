import { and, desc, eq } from "drizzle-orm";
import { AnswerSchema, scoreAssessment, type Answer, type AssessmentResult } from "@cumplia/core";
import { loadFramework } from "@cumplia/frameworks";
import type { Db } from "./client.js";
import { assessments, auditLogs, controlAnswers, evidence, organizations } from "./schema.js";

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} no encontrado`);
    this.name = "NotFoundError";
  }
}

export async function createOrganization(db: Db, name: string) {
  const [org] = await db.insert(organizations).values({ name }).returning();
  if (!org) throw new Error("No se pudo crear la organización");
  return org;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Único punto de acceso a datos de negocio. Recibe la organización UNA vez y
 * cada consulta la aplica; no existe forma de leer o escribir fuera de ella.
 * Cada cambio deja un registro de auditoría en la misma transacción.
 */
export function forOrganization(db: Db, organizationId: string, actorId: string | null = null) {
  const audit = (tx: Tx, action: string, entity: string, entityId: string | null) =>
    tx.insert(auditLogs).values({ organizationId, actorId, action, entity, entityId });

  const ownedAssessment = async (tx: Tx | Db, assessmentId: string) => {
    const [row] = await tx
      .select()
      .from(assessments)
      .where(and(eq(assessments.id, assessmentId), eq(assessments.organizationId, organizationId)));
    return row ?? null;
  };

  return {
    async createAssessment(frameworkId: string, targetMaturity = 3) {
      loadFramework(frameworkId); // valida que exista
      return db.transaction(async (tx) => {
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
      return db
        .select()
        .from(assessments)
        .where(eq(assessments.organizationId, organizationId))
        .orderBy(desc(assessments.createdAt));
    },

    getAssessment(assessmentId: string) {
      return ownedAssessment(db, assessmentId);
    },

    async saveAnswers(assessmentId: string, rawAnswers: Answer[]) {
      const answers = rawAnswers.map((a) => AnswerSchema.parse(a));
      const framework = (id: string) => loadFramework(id);
      return db.transaction(async (tx) => {
        const assessment = await ownedAssessment(tx, assessmentId);
        if (!assessment) throw new NotFoundError("Evaluación");
        const valid = new Set(framework(assessment.frameworkId).controls.map((c) => c.id));
        for (const a of answers) {
          if (!valid.has(a.controlId)) throw new Error(`Control inexistente: ${a.controlId}`);
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

    async getAnswers(assessmentId: string): Promise<Answer[]> {
      const rows = await db
        .select()
        .from(controlAnswers)
        .where(and(eq(controlAnswers.assessmentId, assessmentId), eq(controlAnswers.organizationId, organizationId)));
      return rows.map((r) => ({
        controlId: r.controlId,
        applicable: r.applicable,
        maturity: r.maturity ?? undefined,
        justification: r.justification ?? undefined,
      }));
    },

    async computeResult(assessmentId: string): Promise<AssessmentResult> {
      const assessment = await ownedAssessment(db, assessmentId);
      if (!assessment) throw new NotFoundError("Evaluación");
      const answers = await this.getAnswers(assessmentId);
      return scoreAssessment(loadFramework(assessment.frameworkId), answers, assessment.targetMaturity);
    },

    async addEvidence(assessmentId: string, controlId: string, source: string, description: string) {
      return db.transaction(async (tx) => {
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

    listAuditLog(limit = 50) {
      return db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.organizationId, organizationId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit);
    },
  };
}

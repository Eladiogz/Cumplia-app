import { buildStatementOfApplicability } from "@cumplia/core";
import { loadFramework } from "@cumplia/frameworks";
import { NotFoundError, forOrganization, getUserById, type Db } from "@cumplia/db";
import type { Tenant } from "../tenant.js";
import type { SoaReport } from "./soa-data.js";

/**
 * Reúne los datos de la SoA de una evaluación de ESTA organización (todo pasa por
 * forOrganization: con RLS y filtro por organización). Lanza NotFound si no es suya.
 */
export async function buildSoaReport(db: Db, tenant: Tenant, assessmentId: string): Promise<SoaReport> {
  const repo = forOrganization(db, tenant.organizationId, tenant.actorId);
  const assessment = await repo.getAssessment(assessmentId);
  if (!assessment) throw new NotFoundError("Evaluación");
  const framework = loadFramework(assessment.frameworkId);
  // En secuencia: cada llamada es su propia transacción (con el contexto de RLS).
  const answers = await repo.getAnswers(assessmentId);
  const result = await repo.computeResult(assessmentId);
  const evidence = await repo.listEvidence(assessmentId);
  const organization = await repo.getOrganization();
  const actor = tenant.actorId ? await getUserById(db, tenant.actorId) : null;

  const evidenceCount = new Map<string, number>();
  for (const ev of evidence) evidenceCount.set(ev.controlId, (evidenceCount.get(ev.controlId) ?? 0) + 1);
  const domainOf = new Map(framework.controls.map((c) => [c.id, c.domain]));

  return {
    organizationName: organization.name,
    assessmentName: assessment.name,
    frameworkName: framework.name,
    targetMaturity: assessment.targetMaturity,
    generatedAt: new Date(),
    generatedBy: actor ? (actor.name ? `${actor.name} <${actor.email}>` : actor.email) : "—",
    domains: framework.domains,
    entries: buildStatementOfApplicability(framework, answers).map((e) => ({
      ...e,
      domain: domainOf.get(e.controlId) ?? "",
      evidenceCount: evidenceCount.get(e.controlId) ?? 0,
    })),
    result,
  };
}

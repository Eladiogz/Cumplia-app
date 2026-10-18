import { and, asc, eq, sql } from "drizzle-orm";
import { riskProblem, type RiskStatus, type RiskTreatment } from "@cumplia/core/risk";
import { loadFramework } from "@cumplia/frameworks";
import { memberships, risks, users, type AuditDetails } from "./schema.js";
import { NotFoundError, ValidationError } from "./errors.js";
import type { Tx } from "./repository.js";

/** Marco cuyos controles del Anexo A pueden tratar riesgos. */
export const RISK_CONTROL_FRAMEWORK = "iso27001-2022";

export interface RiskInput {
  title: string;
  description?: string | null;
  asset?: string | null;
  threat?: string | null;
  likelihood: number;
  impact: number;
  treatment?: RiskTreatment;
  treatmentPlan?: string | null;
  controlIds?: string[];
  residualLikelihood?: number | null;
  residualImpact?: number | null;
  status?: RiskStatus;
  ownerId?: string | null;
  /** AAAA-MM-DD */
  dueDate?: string | null;
}

interface Context {
  organizationId: string;
  inTenant: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  audit: (tx: Tx, action: string, entity: string, entityId: string | null, details?: AuditDetails) => Promise<unknown>;
}

const riskColumns = {
  id: risks.id,
  number: risks.number,
  title: risks.title,
  description: risks.description,
  asset: risks.asset,
  threat: risks.threat,
  likelihood: risks.likelihood,
  impact: risks.impact,
  treatment: risks.treatment,
  treatmentPlan: risks.treatmentPlan,
  controlIds: risks.controlIds,
  residualLikelihood: risks.residualLikelihood,
  residualImpact: risks.residualImpact,
  status: risks.status,
  ownerId: risks.ownerId,
  ownerName: users.name,
  ownerEmail: users.email,
  dueDate: risks.dueDate,
  createdAt: risks.createdAt,
  updatedAt: risks.updatedAt,
};

let knownControls: Set<string> | null = null;
const controlIdsOf = () => (knownControls ??= new Set(loadFramework(RISK_CONTROL_FRAMEWORK).controls.map((c) => c.id)));

/** Normaliza y valida lo que no expresa el esquema: controles existentes y reglas entre campos. */
function validate(input: RiskInput) {
  const controlIds = [...new Set(input.controlIds ?? [])];
  const unknown = controlIds.filter((id) => !controlIdsOf().has(id));
  if (unknown.length > 0) throw new ValidationError(`Controles desconocidos: ${unknown.join(", ")}`);
  const problem = riskProblem({ treatment: input.treatment ?? "mitigate", status: input.status ?? "identified", ...input });
  if (problem) throw new ValidationError(problem);
  return { ...input, controlIds: controlIds.sort((a, b) => a.localeCompare(b, "en", { numeric: true })) };
}

/** Registro de riesgos de UNA organización (se usa a través de forOrganization). */
export function riskMethods({ organizationId, inTenant, audit }: Context) {
  const ownRisk = eq(risks.organizationId, organizationId);

  const selectRisks = (tx: Tx) =>
    tx
      .select(riskColumns)
      .from(risks)
      .leftJoin(users, eq(users.id, risks.ownerId));

  /** El responsable tiene que ser miembro de ESTA organización (la FK compuesta también lo garantiza). */
  const assertOwner = async (tx: Tx, ownerId: string | null | undefined) => {
    if (!ownerId) return;
    const [m] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, ownerId), eq(memberships.organizationId, organizationId)));
    if (!m) throw new ValidationError("El responsable debe ser miembro de la organización");
  };

  const getRisk = async (tx: Tx, riskId: string) => {
    const [row] = await selectRisks(tx).where(and(eq(risks.id, riskId), ownRisk));
    if (!row) throw new NotFoundError("Riesgo");
    return row;
  };

  const summary = (r: { number: number; title: string; likelihood: number; impact: number; status: string }) => ({
    number: r.number,
    title: r.title,
    likelihood: r.likelihood,
    impact: r.impact,
    status: r.status,
  });

  return {
    listRisks() {
      return inTenant((tx) => selectRisks(tx).where(ownRisk).orderBy(asc(risks.number)));
    },

    getRisk(riskId: string) {
      return inTenant((tx) => getRisk(tx, riskId));
    },

    async createRisk(input: RiskInput) {
      const values = validate(input);
      return inTenant(async (tx) => {
        await assertOwner(tx, values.ownerId);
        // Serializa las altas de la organización: el correlativo nunca se repite ni salta por concurrencia.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"risks:" + organizationId}))`);
        const [next] = await tx
          .select({ n: sql<number>`coalesce(max(${risks.number}), 0)::int + 1` })
          .from(risks)
          .where(ownRisk);
        const [created] = await tx
          .insert(risks)
          .values({ ...values, organizationId, number: next?.n ?? 1 })
          .returning({ id: risks.id });
        if (!created) throw new Error("No se pudo crear el riesgo");
        const risk = await getRisk(tx, created.id);
        await audit(tx, "risk.create", "risk", risk.id, summary(risk));
        return risk;
      });
    },

    /** Cambios parciales: las reglas entre campos se validan sobre el riesgo resultante. */
    async updateRisk(riskId: string, changes: Partial<RiskInput>) {
      return inTenant(async (tx) => {
        const current = await getRisk(tx, riskId);
        const values = validate({ ...current, ...changes });
        if (changes.ownerId !== undefined && changes.ownerId !== current.ownerId) await assertOwner(tx, changes.ownerId);
        const patch = Object.fromEntries(
          Object.keys(changes).map((k) => [k, values[k as keyof typeof values]]),
        ) as Partial<RiskInput>;
        await tx
          .update(risks)
          .set({ ...patch, updatedAt: sql`now()` })
          .where(and(eq(risks.id, riskId), ownRisk));
        const risk = await getRisk(tx, riskId);
        const changed: AuditDetails = {};
        for (const key of Object.keys(changes) as (keyof RiskInput)[]) {
          const before = current[key as keyof typeof current];
          const after = risk[key as keyof typeof risk];
          if (JSON.stringify(before) === JSON.stringify(after)) continue;
          changed[key] = Array.isArray(after) ? after.join(", ") : (after as string | number | null);
        }
        await audit(tx, "risk.update", "risk", riskId, { number: risk.number, ...changed });
        return risk;
      });
    },

    /** Borra un riesgo (queda en la auditoría con su resumen). */
    async deleteRisk(riskId: string) {
      await inTenant(async (tx) => {
        const risk = await getRisk(tx, riskId);
        await tx.delete(risks).where(and(eq(risks.id, riskId), ownRisk));
        await audit(tx, "risk.delete", "risk", riskId, summary(risk));
      });
    },

    /** Miembros que pueden ser responsables de un riesgo. */
    listRiskOwners() {
      return inTenant((tx) =>
        tx
          .select({ userId: users.id, name: users.name, email: users.email })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(eq(memberships.organizationId, organizationId))
          .orderBy(asc(users.email)),
      );
    },
  };
}

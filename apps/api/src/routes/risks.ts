import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { RISK_STATUSES, RISK_TREATMENTS } from "@cumplia/core/risk";
import { forOrganization, getUserById, type Db } from "@cumplia/db";
import { riskFileName, riskRegisterToXlsx } from "../reports/risk-xlsx.js";
import { requires } from "../security/permissions.js";
import { contentDisposition } from "../storage/files.js";

const RiskParams = z.object({ riskId: z.string().uuid() });
const Level = z.number().int().min(1).max(5);
/** Texto opcional: vacío o solo espacios se guarda como null. */
const OptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const fields = {
  title: z.string().trim().min(1).max(200),
  description: OptionalText(4000),
  asset: OptionalText(200),
  threat: OptionalText(1000),
  likelihood: Level,
  impact: Level,
  treatment: z.enum(RISK_TREATMENTS),
  treatmentPlan: OptionalText(4000),
  controlIds: z.array(z.string().regex(/^A\.\d+\.\d+$/)).max(93),
  residualLikelihood: Level.nullable(),
  residualImpact: Level.nullable(),
  status: z.enum(RISK_STATUSES),
  ownerId: z.string().uuid().nullable(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((d) => !Number.isNaN(Date.parse(d)), { message: "Fecha inválida" })
    .nullable(),
};

const CreateBody = z.object({
  ...fields,
  treatment: fields.treatment.default("mitigate"),
  controlIds: fields.controlIds.default([]),
  residualLikelihood: fields.residualLikelihood.optional(),
  residualImpact: fields.residualImpact.optional(),
  status: fields.status.default("identified"),
  ownerId: fields.ownerId.optional(),
  dueDate: fields.dueDate.optional(),
});

const UpdateBody = z
  .object(fields)
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "Nada para actualizar" });

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface Options {
  db: Db;
}

/**
 * Registro de riesgos (ISO/IEC 27001 6.1.2 y 6.1.3). Se registra dentro de
 * protectedRoutes: tenant y permisos ya están verificados; cada consulta pasa
 * por forOrganization (filtro por organización + RLS) y cada cambio se audita.
 */
export async function riskRoutes(app: FastifyInstance, opts: Options) {
  const repo = (req: FastifyRequest) => {
    if (!req.tenant) throw new Error("Tenant ausente");
    return forOrganization(opts.db, req.tenant.organizationId, req.tenant.actorId);
  };

  app.get("/risks", requires("risk:read"), async (req) => repo(req).listRisks());

  app.post("/risks", requires("risk:write"), async (req, reply) => {
    const created = await repo(req).createRisk(CreateBody.parse(req.body));
    return reply.code(201).send(created);
  });

  /** Miembros que se pueden asignar como responsables (solo para quien edita riesgos). */
  app.get("/risks/owners", requires("risk:write"), async (req) => repo(req).listRiskOwners());

  /** Exportar el registro. Lectura (también AUDITOR), con email verificado y auditado. */
  app.get("/risks.xlsx", requires("risk:read", { verifiedEmail: true }), async (req, reply) => {
    const r = repo(req);
    const risks = await r.listRisks();
    const organization = await r.getOrganization();
    const actorId = req.tenant!.actorId;
    const actor = actorId ? await getUserById(opts.db, actorId) : null;
    const report = {
      organizationName: organization.name,
      generatedAt: new Date(),
      generatedBy: actor ? (actor.name ? `${actor.name} <${actor.email}>` : actor.email) : "—",
      risks,
    };
    const body = await riskRegisterToXlsx(report);
    await r.record("risk.export", "risk", null, { format: "xlsx", risks: risks.length });
    return reply
      .header("content-type", XLSX_TYPE)
      .header("content-disposition", contentDisposition(riskFileName(report), "attachment"))
      .header("cache-control", "private, no-store")
      .send(body);
  });

  app.get("/risks/:riskId", requires("risk:read"), async (req) => {
    const { riskId } = RiskParams.parse(req.params);
    return repo(req).getRisk(riskId);
  });

  app.patch("/risks/:riskId", requires("risk:write"), async (req) => {
    const { riskId } = RiskParams.parse(req.params);
    return repo(req).updateRisk(riskId, UpdateBody.parse(req.body));
  });

  app.delete("/risks/:riskId", requires("risk:delete"), async (req, reply) => {
    const { riskId } = RiskParams.parse(req.params);
    await repo(req).deleteRisk(riskId);
    return reply.code(204).send();
  });
}

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AnswerSchema, buildStatementOfApplicability } from "@cumplia/core";
import { loadFramework } from "@cumplia/frameworks";
import { NotFoundError, forOrganization, type Db } from "@cumplia/db";
import type { TenantResolver } from "../tenant.js";

const IdParams = z.object({ id: z.string().uuid() });
const CreateBody = z.object({
  frameworkId: z.string().min(1),
  targetMaturity: z.number().int().min(1).max(4).default(3),
});
const AnswersBody = z.object({ answers: z.array(AnswerSchema).max(500) });
const EvidenceBody = z.object({
  controlId: z.string().min(1),
  source: z.string().min(1).max(50),
  description: z.string().min(1).max(2000),
});

interface Options {
  db: Db;
  resolveTenant: TenantResolver;
}

export async function assessmentRoutes(app: FastifyInstance, opts: Options) {
  app.decorateRequest("tenant", null);

  // Falla cerrado: sin tenant válido no se llega a ninguna ruta de este plugin.
  app.addHook("preHandler", async (req, reply) => {
    const tenant = await opts.resolveTenant(req);
    if (!tenant) return reply.code(401).send({ error: "No autenticado" });
    req.tenant = tenant;
  });

  const repo = (req: FastifyRequest) => {
    if (!req.tenant) throw new Error("Tenant ausente");
    return forOrganization(opts.db, req.tenant.organizationId, req.tenant.actorId);
  };

  app.post("/assessments", async (req, reply) => {
    const body = CreateBody.parse(req.body);
    const created = await repo(req).createAssessment(body.frameworkId, body.targetMaturity);
    return reply.code(201).send(created);
  });

  app.get("/assessments", async (req) => repo(req).listAssessments());

  app.get("/assessments/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    const found = await repo(req).getAssessment(id);
    if (!found) throw new NotFoundError("Evaluación");
    return found;
  });

  app.get("/assessments/:id/answers", async (req) => {
    const { id } = IdParams.parse(req.params);
    const r = repo(req);
    if (!(await r.getAssessment(id))) throw new NotFoundError("Evaluación");
    return r.getAnswers(id);
  });

  app.put("/assessments/:id/answers", async (req) => {
    const { id } = IdParams.parse(req.params);
    const { answers } = AnswersBody.parse(req.body);
    return { saved: await repo(req).saveAnswers(id, answers) };
  });

  app.get("/assessments/:id/result", async (req) => {
    const { id } = IdParams.parse(req.params);
    return repo(req).computeResult(id);
  });

  app.get("/assessments/:id/soa", async (req) => {
    const { id } = IdParams.parse(req.params);
    const r = repo(req);
    const found = await r.getAssessment(id);
    if (!found) throw new NotFoundError("Evaluación");
    return buildStatementOfApplicability(loadFramework(found.frameworkId), await r.getAnswers(id));
  });

  app.post("/assessments/:id/evidence", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const body = EvidenceBody.parse(req.body);
    const ev = await repo(req).addEvidence(id, body.controlId, body.source, body.description);
    return reply.code(201).send(ev);
  });

  // TODO(feat/rbac): restringir a ADMIN y AUDITOR
  app.get("/audit-log", async (req) => repo(req).listAuditLog());
}

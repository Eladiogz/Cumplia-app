import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AnswerSchema, buildStatementOfApplicability } from "@cumplia/core";
import { loadFramework } from "@cumplia/frameworks";
import { NotFoundError, forOrganization, type Db } from "@cumplia/db";
import { requires } from "../security/permissions.js";

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
}

const READ = requires("assessment:read");
const WRITE = requires("assessment:write");

/** Se registra dentro de protectedRoutes: tenant y permisos ya están verificados. */
export async function assessmentRoutes(app: FastifyInstance, opts: Options) {
  const repo = (req: FastifyRequest) => {
    if (!req.tenant) throw new Error("Tenant ausente");
    return forOrganization(opts.db, req.tenant.organizationId, req.tenant.actorId);
  };

  app.post("/assessments", WRITE, async (req, reply) => {
    const body = CreateBody.parse(req.body);
    const created = await repo(req).createAssessment(body.frameworkId, body.targetMaturity);
    return reply.code(201).send(created);
  });

  app.get("/assessments", READ, async (req) => repo(req).listAssessments());

  app.get("/assessments/:id", READ, async (req) => {
    const { id } = IdParams.parse(req.params);
    const found = await repo(req).getAssessment(id);
    if (!found) throw new NotFoundError("Evaluación");
    return found;
  });

  app.get("/assessments/:id/answers", READ, async (req) => {
    const { id } = IdParams.parse(req.params);
    const r = repo(req);
    if (!(await r.getAssessment(id))) throw new NotFoundError("Evaluación");
    return r.getAnswers(id);
  });

  app.put("/assessments/:id/answers", WRITE, async (req) => {
    const { id } = IdParams.parse(req.params);
    const { answers } = AnswersBody.parse(req.body);
    return { saved: await repo(req).saveAnswers(id, answers) };
  });

  app.get("/assessments/:id/result", READ, async (req) => {
    const { id } = IdParams.parse(req.params);
    return repo(req).computeResult(id);
  });

  app.get("/assessments/:id/soa", READ, async (req) => {
    const { id } = IdParams.parse(req.params);
    const r = repo(req);
    const found = await r.getAssessment(id);
    if (!found) throw new NotFoundError("Evaluación");
    return buildStatementOfApplicability(loadFramework(found.frameworkId), await r.getAnswers(id));
  });

  app.post("/assessments/:id/evidence", WRITE, async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const body = EvidenceBody.parse(req.body);
    const ev = await repo(req).addEvidence(id, body.controlId, body.source, body.description);
    return reply.code(201).send(ev);
  });

  app.get("/audit-log", requires("audit:read"), async (req) => repo(req).listAuditLog());
}

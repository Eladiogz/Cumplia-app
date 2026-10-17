import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AnswerSchema, buildStatementOfApplicability } from "@cumplia/core";
import { loadFramework } from "@cumplia/frameworks";
import { NotFoundError, forOrganization, type Db } from "@cumplia/db";
import { requires } from "../security/permissions.js";

const IdParams = z.object({ id: z.string().uuid() });
const Name = z.string().trim().min(1).max(120);
const Target = z.number().int().min(1).max(4);
const CreateBody = z.object({
  frameworkId: z.string().min(1),
  name: Name.optional(),
  targetMaturity: Target.default(3),
});
const UpdateBody = z
  .object({ name: Name.optional(), targetMaturity: Target.optional() })
  .refine((b) => b.name !== undefined || b.targetMaturity !== undefined, { message: "Nada para actualizar" });

/** Cantidad de controles del marco (para mostrar el avance). */
const controlCount = (frameworkId: string) => {
  try {
    return loadFramework(frameworkId).controls.length;
  } catch {
    return 0;
  }
};
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
    const created = await repo(req).createAssessment(body.frameworkId, body.targetMaturity, body.name);
    return reply.code(201).send(created);
  });

  app.get("/assessments", READ, async (req) => {
    const list = await repo(req).listAssessments();
    return list.map((a) => ({ ...a, total: controlCount(a.frameworkId) }));
  });

  app.patch("/assessments/:id", WRITE, async (req) => {
    const { id } = IdParams.parse(req.params);
    return repo(req).updateAssessment(id, UpdateBody.parse(req.body));
  });

  app.get("/assessments/:id/evidence", READ, async (req) => {
    const { id } = IdParams.parse(req.params);
    return repo(req).listEvidence(id);
  });

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

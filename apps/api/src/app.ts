import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { ZodError, z } from "zod";
import { listFrameworks, loadFramework } from "@cumplia/frameworks";
import { AnswerSchema, buildStatementOfApplicability, scoreAssessment } from "@cumplia/core";
import { NotFoundError, ValidationError, type Db } from "@cumplia/db";
import { assessmentRoutes } from "./routes/assessments.js";
import type { TenantResolver } from "./tenant.js";

const AssessmentBody = z.object({
  answers: z.array(AnswerSchema),
  targetMaturity: z.number().int().min(1).max(4).default(3),
});

export interface AppOptions {
  /** Si se omite, solo quedan las rutas sin estado (marcos y cálculo). */
  db?: Db;
  resolveTenant?: TenantResolver;
}

export function buildApp({ db, resolveTenant = () => null }: AppOptions = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  app.register(helmet);
  app.register(rateLimit, { max: 100, timeWindow: "1 minute" });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "Solicitud inválida", details: err.flatten() });
    }
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
    const e = err as Error & { statusCode?: number };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
    req.log.error(err);
    return reply.code(500).send({ error: "Error interno" });
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/frameworks", async () => listFrameworks());

  app.get<{ Params: { id: string } }>("/frameworks/:id", async (req, reply) => {
    try {
      return loadFramework(req.params.id);
    } catch {
      return reply.code(404).send({ error: "Marco normativo no encontrado" });
    }
  });

  app.post<{ Params: { id: string } }>("/frameworks/:id/assessment", async (req, reply) => {
    const parsed = AssessmentBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Solicitud inválida", details: parsed.error.flatten() });
    }
    let framework;
    try {
      framework = loadFramework(req.params.id);
    } catch {
      return reply.code(404).send({ error: "Marco normativo no encontrado" });
    }
    try {
      const { answers, targetMaturity } = parsed.data;
      return {
        result: scoreAssessment(framework, answers, targetMaturity),
        soa: buildStatementOfApplicability(framework, answers),
      };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  if (db) app.register(assessmentRoutes, { db, resolveTenant });

  return app;
}

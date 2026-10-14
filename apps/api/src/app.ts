import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { listFrameworks, loadFramework } from "@cumplia/frameworks";
import { AnswerSchema, buildStatementOfApplicability, scoreAssessment } from "@cumplia/core";

const AssessmentBody = z.object({
  answers: z.array(AnswerSchema),
  targetMaturity: z.number().int().min(1).max(4).default(3),
});

export function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  app.register(helmet);
  app.register(rateLimit, { max: 100, timeWindow: "1 minute" });

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

  return app;
}

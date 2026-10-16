import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { ZodError, z } from "zod";
import { listFrameworks, loadFramework } from "@cumplia/frameworks";
import { AnswerSchema, buildStatementOfApplicability, scoreAssessment } from "@cumplia/core";
import { ConflictError, NotFoundError, ValidationError, type Db } from "@cumplia/db";
import { authRoutes } from "./routes/auth.js";
import { assessmentRoutes } from "./routes/assessments.js";
import { mfaRoutes } from "./routes/mfa.js";
import type { TenantResolver } from "./tenant.js";

const AssessmentBody = z.object({
  answers: z.array(AnswerSchema),
  targetMaturity: z.number().int().min(1).max(4).default(3),
});

export interface AppOptions {
  /** Si se omite, solo quedan las rutas sin estado (marcos y cálculo). */
  db?: Db;
  resolveTenant?: TenantResolver;
  /** Cookies con atributo Secure (obligatorio en producción, sobre HTTPS). */
  secureCookies?: boolean;
  /** Orígenes del frontend autorizados a hacer peticiones que modifican datos. */
  allowedOrigins?: string[];
  /** Peticiones por minuto y por IP a /auth/register, /auth/login y /auth/mfa/*. */
  authRateLimit?: number;
  /**
   * Clave AES-256 para los secretos TOTP. Sin ella no se registran las rutas de MFA
   * (los usuarios con MFA activo no pueden completar el login: falla cerrado).
   */
  mfaEncryptionKey?: Buffer;
}

export function buildApp({
  db,
  resolveTenant = () => null,
  secureCookies = false,
  allowedOrigins = [],
  authRateLimit = 10,
  mfaEncryptionKey,
}: AppOptions = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  app.register(helmet);
  app.register(cookie);
  app.register(rateLimit, { max: 100, timeWindow: "1 minute" });

  // Defensa CSRF adicional a SameSite: un navegador siempre envía Origin en peticiones
  // que modifican datos entre sitios; si no es uno de los nuestros, se rechaza.
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && !["GET", "HEAD", "OPTIONS"].includes(req.method) && !allowedOrigins.includes(origin)) {
      return reply.code(403).send({ error: "Origen no permitido" });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "Solicitud inválida", details: err.flatten() });
    }
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
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

  if (db) {
    app.register(authRoutes, { db, secureCookies, authRateLimit });
    if (mfaEncryptionKey) {
      app.register(mfaRoutes, { db, secureCookies, authRateLimit, encryptionKey: mfaEncryptionKey });
    }
    app.register(assessmentRoutes, { db, resolveTenant });
  }

  return app;
}

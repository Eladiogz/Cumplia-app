import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { ZodError, z } from "zod";
import { listFrameworks, loadFramework } from "@cumplia/frameworks";
import { AnswerSchema, buildStatementOfApplicability, scoreAssessment } from "@cumplia/core";
import { ConflictError, NotFoundError, ValidationError, type Db } from "@cumplia/db";
import { createLogMailer, type Mailer } from "./email/mailer.js";
import { accountRoutes } from "./routes/account.js";
import { authRoutes } from "./routes/auth.js";
import { mfaRoutes } from "./routes/mfa.js";
import { passwordRoutes } from "./routes/password.js";
import { protectedRoutes } from "./protected.js";
import { WeakPasswordError } from "./security/password-policy.js";
import { MAX_EVIDENCE_BYTES } from "./storage/files.js";
import type { ObjectStorage } from "./storage/storage.js";
import { MFA_CHALLENGE_PATH } from "./security/session.js";
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
  /** Peticiones por minuto y por IP al resto de la API. */
  apiRateLimit?: number;
  /**
   * Clave AES-256 para los secretos TOTP. Sin ella no se registran las rutas de MFA
   * (los usuarios con MFA activo no pueden completar el login: falla cerrado).
   */
  mfaEncryptionKey?: Buffer;
  /** Envío de emails. Si se omite, se escriben en el log (solo desarrollo y tests). */
  mailer?: Mailer;
  /** URL del frontend para los links de los emails. Por defecto, el primer origen autorizado. */
  appUrl?: string;
  /**
   * Proxies de confianza (p. ej. "127.0.0.1" para el proxy de la web). Solo de ellos se
   * acepta X-Forwarded-For: sin esto, detrás del proxy todos compartirían el límite por IP;
   * con `true` a ciegas, cualquiera podría falsificar su IP.
   */
  trustProxy?: boolean | string;
  /** Prefijo con el que el navegador ve la API (p. ej. "/api" detrás del proxy de la web). */
  publicPathPrefix?: string;
  /** Almacenamiento de archivos de evidencia (S3). Sin él, la carga de archivos responde 503. */
  storage?: ObjectStorage;
}

export function buildApp({
  db,
  resolveTenant = () => null,
  secureCookies = false,
  allowedOrigins = [],
  authRateLimit = 10,
  apiRateLimit = 100,
  mfaEncryptionKey,
  mailer: givenMailer,
  appUrl = allowedOrigins[0] ?? "http://localhost:3001",
  trustProxy = false,
  publicPathPrefix = "",
  storage,
}: AppOptions = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", trustProxy });
  const mailer = givenMailer ?? createLogMailer(app.log);
  // La cookie del desafío MFA solo viaja a sus rutas, tal como las ve el navegador.
  const mfaCookiePath = `${publicPathPrefix.replace(/\/$/, "")}${MFA_CHALLENGE_PATH}`;

  app.register(helmet);
  app.register(cookie);
  // Solo lee el archivo cuando la ruta lo pide (req.file()), después de verificar sesión y permisos.
  app.register(multipart, { limits: { fileSize: MAX_EVIDENCE_BYTES, files: 1 } });
  app.register(rateLimit, { max: apiRateLimit, timeWindow: "1 minute" });

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
    if (err instanceof WeakPasswordError) {
      return reply.code(400).send({ error: err.message, code: "WEAK_PASSWORD", rules: err.rules });
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
    app.register(authRoutes, { db, secureCookies, authRateLimit, mailer, mfaCookiePath, appUrl });
    app.register(passwordRoutes, { db, mailer, appUrl, authRateLimit });
    app.register(accountRoutes, { db, secureCookies, authRateLimit });
    if (mfaEncryptionKey) {
      app.register(mfaRoutes, { db, secureCookies, authRateLimit, encryptionKey: mfaEncryptionKey, mailer, mfaCookiePath });
    }
    app.register(protectedRoutes, { db, resolveTenant, mailer, appUrl, storage });
  }

  return app;
}

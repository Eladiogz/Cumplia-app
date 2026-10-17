import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MultipartFields } from "@fastify/multipart";
import { z } from "zod";
import { AnswerSchema, buildStatementOfApplicability } from "@cumplia/core";
import { loadFramework } from "@cumplia/frameworks";
import { NotFoundError, forOrganization, type Db } from "@cumplia/db";
import { requires } from "../security/permissions.js";
import { MAX_EVIDENCE_BYTES, contentDisposition, detectFileType, safeFileName, sha256 } from "../storage/files.js";
import type { ObjectStorage } from "../storage/storage.js";

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

const EvidenceParams = z.object({ id: z.string().uuid(), evidenceId: z.string().uuid() });
const FileFields = z.object({
  controlId: z.string().min(1).max(20),
  description: z.string().trim().max(2000).optional(),
});

/** Valor de un campo de texto de un formulario multipart (o undefined). */
const fieldValue = (fields: MultipartFields, name: string) => {
  const field = fields[name];
  const first = Array.isArray(field) ? field[0] : field;
  return first && first.type === "field" ? String(first.value) : undefined;
};

interface Options {
  db: Db;
  /** Sin almacenamiento configurado, la carga de archivos responde 503. */
  storage?: ObjectStorage;
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

  /**
   * Evidencia con archivo (multipart: campos `controlId` y `description` ANTES del archivo).
   * Orden de verificación: la evaluación es de esta organización → hay almacenamiento →
   * tamaño → tipo real por contenido. Recién entonces se guarda.
   */
  app.post("/assessments/:id/evidence/files", WRITE, async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const r = repo(req);
    if (!(await r.getAssessment(id))) throw new NotFoundError("Evaluación");
    const { storage } = opts;
    if (!storage) return reply.code(503).send({ error: "La carga de archivos no está configurada en este servidor" });
    if (!req.isMultipart()) return reply.code(415).send({ error: "Enviá el archivo como multipart/form-data" });

    const part = await req.file({ limits: { fileSize: MAX_EVIDENCE_BYTES, files: 1, fields: 4, fieldSize: 2000 } });
    if (!part) return reply.code(400).send({ error: "Falta el archivo" });
    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch (e) {
      if ((e as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.code(413).send({ error: "El archivo supera el máximo de 10 MB" });
      }
      throw e;
    }
    const fields = FileFields.parse({ controlId: fieldValue(part.fields, "controlId"), description: fieldValue(part.fields, "description") });
    const type = detectFileType(buffer);
    if (!type) return reply.code(415).send({ error: "Formato no permitido: solo imágenes PNG, JPG o WebP y documentos PDF" });

    const tenant = req.tenant!;
    const evidenceId = randomUUID();
    const name = safeFileName(part.filename, type);
    const key = `org/${tenant.organizationId}/assessments/${id}/evidence/${evidenceId}`;
    await storage.put(key, buffer, type.contentType);
    try {
      const ev = await r.addEvidence(id, fields.controlId, "archivo", fields.description || name, {
        id: evidenceId,
        key,
        name,
        size: buffer.length,
        contentType: type.contentType,
        sha256: sha256(buffer),
      });
      return reply.code(201).send(ev);
    } catch (e) {
      // Sin registro en la base, el archivo no debe quedar huérfano en el almacenamiento.
      await storage.delete(key).catch((err: unknown) => req.log.error({ err, key }, "No se pudo borrar un archivo huérfano"));
      throw e;
    }
  });

  /**
   * Descarga el archivo de una evidencia. Siempre a través de la API (que verifica
   * organización y permiso), nunca con un link directo al almacenamiento. Cabeceras
   * que impiden que el navegador lo interprete como otra cosa o ejecute código.
   */
  app.get("/assessments/:id/evidence/:evidenceId/file", READ, async (req, reply) => {
    const { id, evidenceId } = EvidenceParams.parse(req.params);
    const file = await repo(req).getEvidenceFile(id, evidenceId);
    const body = opts.storage ? await opts.storage.get(file.fileKey) : null;
    if (!body) return reply.code(404).send({ error: "El archivo no está disponible" });
    return reply
      .header("content-type", file.contentType)
      .header("content-disposition", contentDisposition(file.fileName))
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox")
      .header("cache-control", "private, no-store")
      .send(body);
  });

  app.delete("/assessments/:id/evidence/:evidenceId", WRITE, async (req, reply) => {
    const { id, evidenceId } = EvidenceParams.parse(req.params);
    const { fileKey } = await repo(req).deleteEvidence(id, evidenceId);
    if (fileKey && opts.storage) {
      await opts.storage.delete(fileKey).catch((err: unknown) => req.log.error({ err, fileKey }, "No se pudo borrar el archivo de una evidencia"));
    }
    return reply.code(204).send();
  });

  app.get("/audit-log", requires("audit:read"), async (req) => repo(req).listAuditLog());
}

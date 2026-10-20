import { strToU8, zipSync, type Zippable } from "fflate";
import type { forOrganization } from "@cumplia/db";

export type OrganizationData = Awaited<ReturnType<ReturnType<typeof forOrganization>["exportData"]>>;

const json = (value: unknown) => strToU8(`${JSON.stringify(value, null, 2)}\n`);

/** Nombre seguro dentro del ZIP: sin rutas ni caracteres reservados (ya viene limpio, por las dudas). */
const zipName = (name: string) =>
  [...name]
    .filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f)
    .join("")
    .replace(/[\\/<>:"|?*]/g, "_")
    .slice(0, 120) || "archivo";

const README = (data: OrganizationData, generatedAt: Date, missing: string[]) =>
  [
    `Exportación de datos de ${data.organization.name} en Cumplia`,
    `Generada: ${generatedAt.toISOString()}`,
    "",
    "Contenido (JSON, UTF-8):",
    "- organizacion.json: datos de la organización",
    "- miembros.json: personas con acceso y su rol",
    "- invitaciones.json: invitaciones enviadas (sin los links)",
    "- evaluaciones.json: evaluaciones con sus respuestas por control y la evidencia registrada",
    "- riesgos.json: registro de riesgos",
    "- auditoria.json: registro de auditoría completo",
    "- evidencias/<evaluación>/<evidencia>-<archivo>: archivos de evidencia (el id de la evidencia",
    "  coincide con el de evaluaciones.json; la huella sha256 permite verificar que no cambiaron)",
    ...(missing.length > 0
      ? ["", "Archivos que no se encontraron en el almacenamiento:", ...missing.map((m) => `- ${m}`)]
      : []),
    "",
  ].join("\n");

/**
 * Arma el ZIP con todos los datos de la organización. `readFile` trae cada archivo
 * de evidencia del almacenamiento (null si ya no existe).
 */
export async function buildOrganizationExport(
  data: OrganizationData,
  readFile: (key: string) => Promise<Buffer | null>,
  generatedAt = new Date(),
): Promise<Uint8Array> {
  const evidenceFiles: Zippable = {};
  const missing: string[] = [];
  for (const f of data.files) {
    const body = await readFile(f.key);
    const path = `${f.assessmentId}/${f.evidenceId}-${zipName(f.fileName)}`;
    if (body) evidenceFiles[path] = [body, { level: 0 }]; // PDF e imágenes ya vienen comprimidos
    else missing.push(path);
  }
  return zipSync({
    "LEEME.txt": strToU8(README(data, generatedAt, missing)),
    "organizacion.json": json(data.organization),
    "miembros.json": json(data.members),
    "invitaciones.json": json(data.invitations),
    "evaluaciones.json": json(data.assessments),
    "riesgos.json": json(data.risks),
    "auditoria.json": json(data.auditLog),
    ...(data.files.length > 0 ? { evidencias: evidenceFiles } : {}),
  });
}

export const exportFileName = (organizationName: string, at = new Date()) =>
  `Cumplia - ${zipName(organizationName)} - ${at.toISOString().slice(0, 10)}.zip`;

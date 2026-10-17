import { createHash } from "node:crypto";

export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

export interface DetectedType {
  contentType: "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
  extension: "png" | "jpg" | "webp" | "pdf";
}

/**
 * Tipo REAL del archivo según sus primeros bytes ("magic numbers"). No se confía en
 * la extensión ni en el content-type que manda el navegador: se pueden falsificar.
 * Solo imágenes y PDF; nada de SVG/HTML, que pueden ejecutar código.
 */
export function detectFileType(buf: Buffer): DetectedType | null {
  const starts = (bytes: number[], offset = 0) => bytes.every((b, i) => buf[offset + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { contentType: "image/png", extension: "png" };
  if (starts([0xff, 0xd8, 0xff])) return { contentType: "image/jpeg", extension: "jpg" };
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) {
    return { contentType: "image/webp", extension: "webp" };
  }
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return { contentType: "application/pdf", extension: "pdf" };
  return null;
}

/**
 * Nombre para mostrar y descargar: sin rutas, sin caracteres de control ni
 * reservados, acotado, y con la extensión del tipo real detectado.
 */
export function safeFileName(original: string | undefined, type: DetectedType): string {
  const withoutPath = (original ?? "").split(/[\\/]/).pop()!.normalize("NFC");
  const printable = [...withoutPath].filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f).join("");
  const base = printable
    .replace(/[<>:"|?*]/g, "")
    .replace(/\.[^.]*$/, "")
    .trim()
    .slice(0, 100);
  return `${base || "evidencia"}.${type.extension}`;
}

/** Huella SHA-256: permite demostrar que el archivo no cambió desde que se cargó. */
export const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

/**
 * Content-Disposition con nombre seguro (RFC 6266/5987): versión ASCII entre comillas
 * y versión UTF-8 codificada, para que tildes y ñ se vean bien.
 */
export function contentDisposition(fileName: string, disposition: "inline" | "attachment" = "inline") {
  const ascii = fileName.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "_") || "evidencia";
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

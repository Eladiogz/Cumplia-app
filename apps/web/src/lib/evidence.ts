/** Tipos y tamaño que acepta la API (la verificación real la hace ella, por contenido). */
export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"] as const;
export const ACCEPT_ATTRIBUTE = ".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf";
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Problema de un archivo antes de subirlo (para avisar sin esperar al servidor). */
export function fileProblem(file: { type: string; size: number }): string | null {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return "Formato no permitido: subí una imagen PNG, JPG o WebP, o un PDF.";
  }
  if (file.size > MAX_FILE_BYTES) return "El archivo supera el máximo de 10 MB.";
  if (file.size === 0) return "El archivo está vacío.";
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export type TextPart = { text: string } | { href: string; text: string };

/**
 * Separa un texto en partes y links, para mostrar como enlace las URLs de una nota.
 * Solo http(s): nunca javascript:, data: ni similares.
 */
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const re = /https?:\/\/[^\s<>"']+/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    // Un punto o paréntesis al final suele ser de la oración, no del link.
    const url = match[0].replace(/[.,;:!?)]+$/, "");
    const start = match.index;
    if (start > last) parts.push({ text: text.slice(last, start) });
    try {
      const parsed = new URL(url);
      parts.push(parsed.protocol === "https:" || parsed.protocol === "http:" ? { href: parsed.href, text: url } : { text: url });
    } catch {
      parts.push({ text: url });
    }
    last = start + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

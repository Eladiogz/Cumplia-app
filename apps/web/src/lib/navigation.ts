/**
 * Destino seguro después de ingresar: solo rutas internas. Evita redirecciones
 * abiertas (`?siguiente=https://sitio-malicioso` o `//sitio-malicioso`).
 */
export function safeNext(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // Caracteres de control (p. ej. "/\t/evil") podrían reinterpretarse como otro host.
  if ([...value].some((c) => c.charCodeAt(0) < 0x20)) return fallback;
  return value;
}

/** Ruta de ingreso que vuelve a `next` al terminar. */
export const loginUrl = (next: string) => `/ingresar?siguiente=${encodeURIComponent(next)}`;

/** Token de invitación del fragmento del link (`#token=...`). */
export function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token && token.length >= 20 ? token : null;
}

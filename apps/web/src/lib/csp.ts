/**
 * Content Security Policy de la web. Los <script> solo corren si traen el nonce de
 * ESTA respuesta (o los carga uno que lo tenía: 'strict-dynamic'); un script
 * inyectado por XSS no lo conoce y el navegador lo bloquea.
 */

/** Nonce aleatorio de 128 bits, distinto en cada petición. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function buildCsp(nonce: string, { dev = false } = {}): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // En desarrollo React usa eval para reconstruir errores; en producción no.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", `'nonce-${nonce}'`],
    // Atributos style="…" (posiciones de gráficos y menús): no ejecutan código y el
    // nonce no los cubre. <style> sueltos siguen necesitando el nonce.
    "style-src-attr": ["'unsafe-inline'"],
    // data: para el QR del MFA (se genera en el navegador); blob: para vistas previas.
    "img-src": ["'self'", "blob:", "data:"],
    "font-src": ["'self'"],
    // Todo dato va por /api (mismo origen). En desarrollo, el recargado en caliente usa websockets.
    "connect-src": ["'self'", ...(dev ? ["ws:"] : [])],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

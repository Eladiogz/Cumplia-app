/** Error de la API con el status HTTP y, si lo hay, el código de negocio (p. ej. MFA_SETUP_REQUIRED). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const FALLBACK_MESSAGES: Record<number, string> = {
  401: "Tu sesión terminó. Volvé a ingresar.",
  403: "No tenés permiso para esta acción.",
  404: "No encontramos lo que buscabas.",
  413: "El archivo es demasiado grande (máximo 10 MB).",
  429: "Demasiados intentos. Esperá un minuto y volvé a probar.",
};

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

/**
 * Llama a la API a través del proxy de la web (/api/*). Mismo origen: la cookie de
 * sesión viaja sola y el navegador agrega el Origin que la API usa contra CSRF.
 */
export async function api<T>(path: string, { method, body }: RequestOptions = {}): Promise<T> {
  // Archivos: FormData va tal cual y el navegador arma el content-type con su separador.
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      // Sin cuerpo no se manda content-type: la API rechaza JSON vacío.
      headers: body === undefined || isForm ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "No pudimos conectar con el servidor. Revisá tu conexión.");
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  if (!res.ok) {
    const fallback = FALLBACK_MESSAGES[res.status] ?? (res.status >= 500 ? "Ocurrió un error en el servidor." : "Solicitud inválida.");
    // Se prefiere el texto propio cuando el de la API no ayuda: el genérico de validación
    // y el del límite de intentos (viene en inglés del plugin de rate limit).
    const useFallback = !data?.error || data.error === "Solicitud inválida" || res.status === 429;
    const message = useFallback ? fallback : data.error!;
    throw new ApiError(res.status, message, data?.code);
  }
  return data as T;
}

/** Mensaje para mostrar de cualquier error. */
export const errorMessage = (e: unknown) => (e instanceof ApiError ? e.message : "Ocurrió un error inesperado.");

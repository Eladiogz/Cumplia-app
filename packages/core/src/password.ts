/**
 * Política de contraseñas, compartida por la API (que decide) y la web (que guía).
 * Combina composición (lo que piden auditores: PCI DSS, ISO 27001) con lo que
 * recomienda NIST SP 800-63B: largo, nada de datos propios y nada de contraseñas
 * comunes o filtradas (esa lista vive en la API: `isCommon`).
 * Sin dependencias: se puede usar en el navegador.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordRule =
  | "length"
  | "tooLong"
  | "lowercase"
  | "uppercase"
  | "digit"
  | "symbol"
  | "repeated"
  | "personal"
  | "common";

export const PASSWORD_RULES: Record<PasswordRule, string> = {
  length: `Al menos ${PASSWORD_MIN_LENGTH} caracteres`,
  // El tope existe para acotar el trabajo del servidor; solo se muestra si se supera.
  tooLong: `Como máximo ${PASSWORD_MAX_LENGTH} caracteres`,
  lowercase: "Una letra minúscula",
  uppercase: "Una letra mayúscula",
  digit: "Un número",
  symbol: "Un carácter especial (por ejemplo ! ? # - _ o un espacio)",
  repeated: "Sin el mismo carácter 4 veces seguidas",
  personal: "Sin tu email, tu nombre, tu organización ni la palabra Cumplia",
  common: "Que no sea una contraseña común o filtrada (por ejemplo «Password123!»)",
};

/** Reglas que se muestran como lista de verificación mientras se escribe. */
export const CHECKLIST_RULES: PasswordRule[] = ["length", "lowercase", "uppercase", "digit", "symbol"];

export interface PasswordContext {
  email?: string | null;
  name?: string | null;
  organizationName?: string | null;
}

/** Fragmentos que delatan una contraseña previsible aunque cumpla la composición. */
const WEAK_FRAGMENTS = [
  "password", "passw0rd", "contrasena", "contraseña", "qwerty", "asdfgh", "zxcvbn", "123456", "654321",
  "abc123", "admin", "welcome", "bienvenid", "letmein", "iloveyou", "teamo", "cumplia",
];

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Palabras del contexto del usuario que no deben aparecer en su contraseña. */
function personalTokens({ email, name, organizationName }: PasswordContext): string[] {
  const local = email?.split("@")[0] ?? "";
  return [local, ...local.split(/[._+-]+/), ...(name ?? "").split(/\s+/), ...(organizationName ?? "").split(/[\s.,&-]+/)]
    .map(fold)
    .filter((t) => t.length >= 4);
}

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" };

/**
 * Variantes a buscar en la lista de contraseñas comunes: tal cual, sin el "relleno"
 * de números y símbolos al principio/final, y sin leetspeak. Así «P@ssw0rd2024!»
 * se reconoce como «password».
 */
export function commonCandidates(password: string): string[] {
  const lower = fold(password);
  const trimmed = lower.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
  const deleet = [...trimmed].map((c) => LEET[c] ?? c).join("");
  return [...new Set([lower, trimmed, deleet, deleet.replace(/[^\p{L}]/gu, "")])].filter((c) => c.length >= 4);
}

/** Reglas que la contraseña NO cumple (vacío = válida). */
export function checkPassword(
  password: string,
  context: PasswordContext = {},
  isCommon: (candidate: string) => boolean = () => false,
): PasswordRule[] {
  const failed: PasswordRule[] = [];
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) failed.push("length");
  if (length > PASSWORD_MAX_LENGTH) failed.push("tooLong");
  if (!/\p{Ll}/u.test(password)) failed.push("lowercase");
  if (!/\p{Lu}/u.test(password)) failed.push("uppercase");
  if (!/\p{Nd}/u.test(password)) failed.push("digit");
  if (!/[^\p{L}\p{Nd}]/u.test(password)) failed.push("symbol");
  if (/(.)\1{3,}/u.test(password)) failed.push("repeated");

  const folded = fold(password);
  if (personalTokens(context).some((t) => folded.includes(t))) failed.push("personal");
  const candidates = commonCandidates(password);
  if (WEAK_FRAGMENTS.some((f) => folded.includes(f)) || candidates.some(isCommon)) failed.push("common");
  return failed;
}

export type PasswordStrength = 0 | 1 | 2 | 3 | 4;
export const STRENGTH_LABELS = ["Muy débil", "Débil", "Aceptable", "Fuerte", "Muy fuerte"] as const;

/** Estimación orientativa para el medidor (la que decide es checkPassword). */
export function passwordStrength(password: string, context: PasswordContext = {}): PasswordStrength {
  if (!password) return 0;
  const failed = checkPassword(password, context);
  if (failed.some((r) => r === "personal" || r === "common" || r === "repeated")) return 0;
  const length = [...password].length;
  const classes = 4 - failed.filter((r) => ["lowercase", "uppercase", "digit", "symbol"].includes(r)).length;
  let score = (length >= 12 ? 1 : 0) + (length >= 16 ? 1 : 0) + (length >= 20 ? 1 : 0) + (classes >= 3 ? 1 : 0) + (classes === 4 ? 1 : 0);
  // Secuencias como "1234" o "abcd" restan.
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|defg)/i.test(password)) score -= 1;
  if (failed.includes("length")) score = Math.min(score, 1);
  return Math.max(0, Math.min(4, score)) as PasswordStrength;
}

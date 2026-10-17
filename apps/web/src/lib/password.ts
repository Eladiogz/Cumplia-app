import { PASSWORD_RULES, checkPassword, type PasswordContext } from "@cumplia/core/password";

/**
 * Valida en el navegador con la misma política que la API (composición y datos
 * personales). La lista de contraseñas comunes/filtradas solo la tiene la API:
 * si la rechaza por eso, el mensaje llega en la respuesta.
 */
export function passwordProblem(password: string, confirm: string, context: PasswordContext): string | null {
  const [first] = checkPassword(password, context);
  if (first) return `La contraseña necesita: ${PASSWORD_RULES[first].toLowerCase()}.`;
  if (password !== confirm) return "Las contraseñas no coinciden.";
  return null;
}

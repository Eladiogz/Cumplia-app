/** Misma política que la API (mínimo 12, máximo 128, distinta del email), validada antes de enviar. */
export function passwordProblem(password: string, confirm: string, email: string): string | null {
  if (password.length < 12) return "La contraseña debe tener al menos 12 caracteres.";
  if (password.length > 128) return "La contraseña no puede superar los 128 caracteres.";
  if (password.toLowerCase() === email.trim().toLowerCase()) return "La contraseña no puede ser tu email.";
  if (password !== confirm) return "Las contraseñas no coinciden.";
  return null;
}

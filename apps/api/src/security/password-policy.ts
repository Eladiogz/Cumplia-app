import { PASSWORD_RULES, checkPassword, type PasswordContext, type PasswordRule } from "@cumplia/core/password";
import { COMMON_PASSWORDS_LIST } from "./common-passwords.js";

const COMMON = new Set(COMMON_PASSWORDS_LIST.split("\n"));

/** La contraseña no cumple la política: la API responde 400 con las reglas que fallaron. */
export class WeakPasswordError extends Error {
  constructor(readonly rules: PasswordRule[]) {
    super(`La contraseña no cumple la política: ${rules.map((r) => PASSWORD_RULES[r].toLowerCase()).join("; ")}.`);
    this.name = "WeakPasswordError";
  }
}

/** Aplica la política completa (composición + datos personales + lista de comunes/filtradas). */
export function assertStrongPassword(password: string, context: PasswordContext) {
  const failed = checkPassword(password, context, (candidate) => COMMON.has(candidate));
  if (failed.length > 0) throw new WeakPasswordError(failed);
}

import { z } from "zod";
import { PASSWORD_MAX_LENGTH } from "@cumplia/core/password";

export const Email = z.string().trim().toLowerCase().email().max(254);

/**
 * Contraseña nueva: aquí solo se acota el tamaño (protege el costo de scrypt);
 * la política completa la aplica assertStrongPassword con el contexto de la persona.
 */
export const NewPassword = z.string().min(1).max(PASSWORD_MAX_LENGTH);

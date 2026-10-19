import { z } from "zod";
import { PASSWORD_MAX_LENGTH } from "@cumplia/core/password";

export const Email = z.string().trim().toLowerCase().email().max(254);

/**
 * Contraseña nueva: aquí solo se acota el tamaño (protege el costo de scrypt);
 * la política completa la aplica assertStrongPassword con el contexto de la persona.
 */
export const NewPassword = z.string().min(1).max(PASSWORD_MAX_LENGTH);

/**
 * Los nombres de organización y de personas aparecen en los emails que envía Cumplia
 * (p. ej. "Ana te invitó a <organización>"). Sin links: si no, alguien podría usar las
 * invitaciones para mandar phishing desde nuestro dominio.
 */
const LINK = /:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|net|org|io|app|ar|co|xyz|ly|me|info|biz|site|online|link)\b/i;
const withoutLinks = (schema: z.ZodString) =>
  schema.refine((v) => !LINK.test(v), { message: "El nombre no puede contener links ni direcciones web" });

export const OrganizationName = withoutLinks(z.string().trim().min(2).max(120));
export const PersonName = withoutLinks(z.string().trim().min(1).max(100));

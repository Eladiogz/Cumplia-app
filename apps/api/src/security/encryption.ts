import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM para secretos que deben poder leerse (p. ej. el secreto TOTP).
// La clave vive fuera de la base (variable de entorno): robar la base no alcanza.
const VERSION = "v1";

/** Valida y decodifica la clave: 32 bytes en base64 (`openssl rand -base64 32`). */
export function parseEncryptionKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("La clave de cifrado debe tener 32 bytes en base64");
  return key;
}

/**
 * `context` se autentica pero no se guarda (AAD): un secreto cifrado para un
 * usuario no se puede copiar a la fila de otro.
 */
export function encrypt(key: Buffer, plaintext: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ct].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decrypt(key: Buffer, payload: string, context: string): Buffer {
  const [version, iv, tag, ct] = payload.split(".");
  if (version !== VERSION || !iv || !tag || ct === undefined) throw new Error("Formato cifrado inválido");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]);
}

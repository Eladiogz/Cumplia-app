import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

// TOTP (RFC 6238) con los parámetros que soportan todas las apps de autenticación:
// HMAC-SHA1, 6 dígitos, pasos de 30 segundos. Sin dependencias.
const PERIOD = 30;
const DIGITS = 6;
/** Pasos aceptados antes y después del actual (tolera ~30 s de desfase de reloj). */
const WINDOW = 1;
const ISSUER = "Cumplia";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) throw new Error("Base32 inválido");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Secreto de 160 bits (el tamaño recomendado para HMAC-SHA1). */
export const newTotpSecret = () => randomBytes(20);

export const timeStep = (nowMs = Date.now()) => Math.floor(nowMs / 1000 / PERIOD);

/** HOTP (RFC 4226) para un paso dado. */
export function hotp(secret: Buffer, step: number, digits = DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", secret).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return bin.toString().padStart(digits, "0");
}

export const totp = (secret: Buffer, nowMs = Date.now()) => hotp(secret, timeStep(nowMs));

/** Devuelve el paso que coincide con el código, o null. El llamador debe impedir reutilizarlo. */
export function verifyTotp(secret: Buffer, code: string, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = timeStep(nowMs);
  let match: number | null = null;
  // Se recorren todos los pasos sin cortar antes, para no filtrar información por tiempos.
  for (let step = current - WINDOW; step <= current + WINDOW; step++) {
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(code))) match = step;
  }
  return match;
}

/** URI que las apps de autenticación leen desde un QR. */
export function otpauthUri(secret: Buffer, accountName: string): string {
  const label = encodeURIComponent(`${ISSUER}:${accountName}`);
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer: ISSUER,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// Códigos de recuperación: 10 dígitos o letras sin caracteres ambiguos (sin 0/o, 1/l/i).
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const RECOVERY_CODE_COUNT = 10;

/** Formato xxxxx-xxxxx: ~49 bits de entropía cada uno, de un solo uso. */
export function newRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const chars = Array.from({ length: 10 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]);
    return `${chars.slice(0, 5).join("")}-${chars.slice(5).join("")}`;
  });
}

/** Ignora mayúsculas, espacios y guiones para que el usuario pueda tipearlo como quiera. */
export const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[\s-]/g, "");

/** Alta entropía: alcanza con SHA-256 (no hace falta un hash lento como con contraseñas). */
export const hashRecoveryCode = (code: string) =>
  createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");

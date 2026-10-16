import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// scrypt (OWASP: N=2^16, r=8, p=1 como mínimo razonable). Sin dependencias nativas.
const N = 65536;
const R = 8;
const P = 1;
const KEYLEN = 64;
const OPTS: ScryptOptions = { N, r: R, p: P, maxmem: 128 * 1024 * 1024 };

const derive = (password: string, salt: Buffer, opts: ScryptOptions = OPTS) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEYLEN, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, keyB64] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await derive(password, Buffer.from(saltB64, "base64"), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 128 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

let dummy: Promise<string> | undefined;
/** Hash falso para gastar el mismo tiempo cuando el email no existe (evita enumerar usuarios por tiempos). */
export const dummyHash = () => (dummy ??= hashPassword("contraseña-que-nadie-usa"));

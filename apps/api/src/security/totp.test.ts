import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, parseEncryptionKey } from "./encryption.js";
import {
  base32Decode,
  base32Encode,
  hashRecoveryCode,
  hotp,
  newRecoveryCodes,
  otpauthUri,
  timeStep,
  totp,
  verifyTotp,
} from "./totp.js";

// Vectores oficiales del RFC 6238 (SHA-1); el RFC usa 8 dígitos, acá se toman los últimos 6.
const RFC_SECRET = Buffer.from("12345678901234567890");
const RFC_VECTORS: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
];

describe("TOTP", () => {
  it("coincide con los vectores del RFC 6238", () => {
    for (const [seconds, expected] of RFC_VECTORS) {
      expect(hotp(RFC_SECRET, timeStep(seconds * 1000), 8)).toBe(expected);
      expect(totp(RFC_SECRET, seconds * 1000)).toBe(expected.slice(-6));
    }
  });

  it("acepta el paso actual y ±1, y devuelve cuál coincidió", () => {
    const now = 1_700_000_000_000;
    const step = timeStep(now);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now), now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 30_000), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now + 30_000), now)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 90_000), now)).toBeNull();
  });

  it("rechaza códigos mal formados", () => {
    for (const bad of ["", "12345", "1234567", "abcdef", " 123456"]) {
      expect(verifyTotp(RFC_SECRET, bad)).toBeNull();
    }
  });

  it("base32 ida y vuelta (RFC 4648)", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    const secret = randomBytes(20);
    expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true);
  });

  it("arma la URI otpauth para el QR", () => {
    const uri = new URL(otpauthUri(RFC_SECRET, "yo@ejemplo.com"));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.host).toBe("totp");
    expect(decodeURIComponent(uri.pathname)).toBe("/Cumplia:yo@ejemplo.com");
    expect(uri.searchParams.get("secret")).toBe(base32Encode(RFC_SECRET));
    expect(uri.searchParams.get("issuer")).toBe("Cumplia");
  });
});

describe("códigos de recuperación", () => {
  it("son 10, distintos y con formato xxxxx-xxxxx", () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
  });

  it("el hash ignora mayúsculas, espacios y guiones", () => {
    expect(hashRecoveryCode("abcde-fghjk")).toBe(hashRecoveryCode(" ABCDE FGHJK "));
    expect(hashRecoveryCode("abcde-fghjk")).toBe(hashRecoveryCode("abcdefghjk"));
    expect(hashRecoveryCode("abcde-fghjk")).not.toContain("abcde");
  });
});

describe("cifrado de secretos", () => {
  const key = randomBytes(32);

  it("cifra y descifra; el texto cifrado no contiene el secreto", () => {
    const secret = randomBytes(20);
    const sealed = encrypt(key, secret, "mfa:usuario-1");
    expect(sealed).not.toContain(base32Encode(secret));
    expect(decrypt(key, sealed, "mfa:usuario-1").equals(secret)).toBe(true);
  });

  it("falla con otra clave, otro contexto o si se altera", () => {
    const sealed = encrypt(key, Buffer.from("secreto"), "mfa:usuario-1");
    expect(() => decrypt(randomBytes(32), sealed, "mfa:usuario-1")).toThrow();
    expect(() => decrypt(key, sealed, "mfa:usuario-2")).toThrow();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("otra-cosa").toString("base64url");
    expect(() => decrypt(key, parts.join("."), "mfa:usuario-1")).toThrow();
  });

  it("valida el largo de la clave", () => {
    expect(() => parseEncryptionKey(randomBytes(16).toString("base64"))).toThrow();
    expect(parseEncryptionKey(key.toString("base64")).equals(key)).toBe(true);
  });
});

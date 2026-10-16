import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";
import { hashToken, newSessionToken } from "./session.js";

describe("contraseñas", () => {
  it("verifica la correcta y rechaza la incorrecta", async () => {
    const h = await hashPassword("una-clave-larga-123");
    expect(await verifyPassword("una-clave-larga-123", h)).toBe(true);
    expect(await verifyPassword("otra-clave-larga-123", h)).toBe(false);
  });

  it("usa sal: el mismo texto da hashes distintos y no contiene la clave", async () => {
    const [a, b] = await Promise.all([hashPassword("misma-clave-123456"), hashPassword("misma-clave-123456")]);
    expect(a).not.toBe(b);
    expect(a).not.toContain("misma-clave");
  });

  it("rechaza hashes mal formados sin lanzar error", async () => {
    expect(await verifyPassword("x", "basura")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$1$2$3$4$5")).toBe(false);
  });
});

describe("tokens de sesión", () => {
  it("son aleatorios y se guardan como hash", () => {
    const t1 = newSessionToken();
    expect(t1).not.toBe(newSessionToken());
    expect(t1.length).toBeGreaterThanOrEqual(43);
    expect(hashToken(t1)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t1)).not.toContain(t1);
  });
});

import { describe, expect, it } from "vitest";
import { buildCsp, newNonce } from "./csp";

const directive = (csp: string, name: string) =>
  csp
    .split("; ")
    .find((d) => d.startsWith(`${name} `))
    ?.slice(name.length + 1)
    .split(" ");

describe("Content Security Policy", () => {
  it("nonce aleatorio de 128 bits, distinto cada vez", () => {
    const a = newNonce();
    expect(atob(a)).toHaveLength(16);
    expect(new Set(Array.from({ length: 50 }, newNonce)).size).toBe(50);
  });

  it("scripts solo con el nonce; nada de unsafe-inline ni eval en producción", () => {
    const csp = buildCsp("abc123");
    expect(directive(csp, "script-src")).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(csp).not.toContain("unsafe-eval");
    expect(directive(csp, "script-src")).not.toContain("'unsafe-inline'");
    expect(directive(csp, "style-src")).not.toContain("'unsafe-inline'");
  });

  it("bloquea objetos, marcos, base y formularios a otros sitios", () => {
    const csp = buildCsp("n");
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
    expect(directive(csp, "connect-src")).toEqual(["'self'"]);
  });

  it("en desarrollo permite eval y websockets (recarga en caliente)", () => {
    const csp = buildCsp("n", { dev: true });
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(directive(csp, "connect-src")).toContain("ws:");
  });
});

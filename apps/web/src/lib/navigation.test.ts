import { describe, expect, it } from "vitest";
import { loginUrl, safeNext, tokenFromHash } from "./navigation";

describe("safeNext (sin redirecciones abiertas)", () => {
  it("acepta rutas internas, incluidas query y fragmento", () => {
    expect(safeNext("/organizacion")).toBe("/organizacion");
    expect(safeNext("/invitaciones/aceptar#token=abc")).toBe("/invitaciones/aceptar#token=abc");
    expect(safeNext("/x?y=1")).toBe("/x?y=1");
  });

  it("rechaza destinos externos o ambiguos", () => {
    for (const bad of ["https://malo.com", "//malo.com", "/\\malo.com", "javascript:alert(1)", "malo.com", "/\t/malo.com"]) {
      expect(safeNext(bad), bad).toBe("/");
    }
    expect(safeNext(null)).toBe("/");
    expect(safeNext("", "/inicio")).toBe("/inicio");
  });

  it("loginUrl codifica el destino completo", () => {
    expect(loginUrl("/invitaciones/aceptar#token=a b")).toBe("/ingresar?siguiente=%2Finvitaciones%2Faceptar%23token%3Da%20b");
  });
});

describe("tokenFromHash", () => {
  it("lee el token del fragmento", () => {
    const token = "x".repeat(43);
    expect(tokenFromHash(`#token=${token}`)).toBe(token);
    expect(tokenFromHash(`token=${token}`)).toBe(token);
  });

  it("ignora fragmentos sin token o con tokens demasiado cortos", () => {
    expect(tokenFromHash("")).toBeNull();
    expect(tokenFromHash("#otra=cosa")).toBeNull();
    expect(tokenFromHash("#token=corto")).toBeNull();
  });
});

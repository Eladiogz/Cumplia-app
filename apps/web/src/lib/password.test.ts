import { describe, expect, it } from "vitest";
import { passwordProblem } from "./password";

describe("política de contraseñas en el formulario", () => {
  it("acepta una contraseña válida y confirmada", () => {
    expect(passwordProblem("una-frase-larga-1", "una-frase-larga-1", "yo@ejemplo.com")).toBeNull();
  });

  it("explica cada problema", () => {
    expect(passwordProblem("corta", "corta", "a@b.com")).toMatch(/12 caracteres/);
    expect(passwordProblem("x".repeat(129), "x".repeat(129), "a@b.com")).toMatch(/128/);
    expect(passwordProblem("Yo.Largo@Ejemplo.com", "Yo.Largo@Ejemplo.com", "yo.largo@ejemplo.com ")).toMatch(/email/);
    expect(passwordProblem("una-frase-larga-1", "otra-frase-larga", "a@b.com")).toMatch(/no coinciden/);
  });
});

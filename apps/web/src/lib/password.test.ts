import { describe, expect, it } from "vitest";
import { passwordProblem } from "./password";

describe("validación de contraseñas en el formulario", () => {
  const ctx = { email: "yo@ejemplo.com", organizationName: "Estudio Contable" };

  it("acepta una contraseña que cumple la política y está confirmada", () => {
    expect(passwordProblem("Mate-con-Bizcochos-7", "Mate-con-Bizcochos-7", ctx)).toBeNull();
  });

  it("explica la primera regla que falta, igual que la API", () => {
    expect(passwordProblem("corta", "corta", ctx)).toMatch(/12/);
    expect(passwordProblem("solo-minusculas-1", "solo-minusculas-1", ctx)).toMatch(/mayúscula/);
    expect(passwordProblem("Contable-Segura-1", "Contable-Segura-1", ctx)).toMatch(/organización/);
    expect(passwordProblem("Password123!xyz", "Password123!xyz", ctx)).toMatch(/común/);
  });

  it("exige que la confirmación coincida", () => {
    expect(passwordProblem("Mate-con-Bizcochos-7", "Mate-con-Bizcochos-8", ctx)).toMatch(/no coinciden/);
  });
});

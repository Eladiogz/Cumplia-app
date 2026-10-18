import { describe, expect, it } from "vitest";
import { riskCode, riskLevel, riskProblem, riskScore } from "./risk.js";

describe("evaluación de riesgos 5×5", () => {
  it("el puntaje es probabilidad × impacto", () => {
    expect(riskScore(1, 1)).toBe(1);
    expect(riskScore(3, 4)).toBe(12);
    expect(riskScore(5, 5)).toBe(25);
  });

  it("clasifica en Bajo, Medio, Alto y Crítico", () => {
    expect([1, 4].map(riskLevel)).toEqual(["low", "low"]);
    expect([5, 9].map(riskLevel)).toEqual(["medium", "medium"]);
    expect([10, 16].map(riskLevel)).toEqual(["high", "high"]);
    expect([20, 25].map(riskLevel)).toEqual(["critical", "critical"]);
  });

  it("aceptar exige justificación y el estado Aceptado exige tratamiento Aceptar", () => {
    const base = { treatment: "mitigate" as const, status: "identified" as const };
    expect(riskProblem(base)).toBeNull();
    expect(riskProblem({ ...base, treatment: "accept" })).toMatch(/justificación/);
    expect(riskProblem({ ...base, treatment: "accept", treatmentPlan: "  " })).toMatch(/justificación/);
    expect(riskProblem({ ...base, treatment: "accept", treatmentPlan: "Costo mayor al beneficio", status: "accepted" })).toBeNull();
    expect(riskProblem({ ...base, status: "accepted" })).toMatch(/Aceptado/);
  });

  it("el residual va completo o vacío", () => {
    const base = { treatment: "mitigate" as const, status: "identified" as const };
    expect(riskProblem({ ...base, residualLikelihood: 2 })).toMatch(/residual/);
    expect(riskProblem({ ...base, residualLikelihood: 2, residualImpact: 1 })).toBeNull();
  });

  it("código correlativo con ceros", () => {
    expect(riskCode(1)).toBe("R-001");
    expect(riskCode(42)).toBe("R-042");
    expect(riskCode(1234)).toBe("R-1234");
  });
});

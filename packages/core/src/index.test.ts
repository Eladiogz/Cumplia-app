import { describe, expect, it } from "vitest";
import { loadFramework } from "@cumplia/frameworks";
import { buildStatementOfApplicability, scoreAssessment, type Answer } from "./index.js";

const fw = loadFramework("iso27001-2022");
const all = (maturity: number): Answer[] =>
  fw.controls.map((c) => ({ controlId: c.id, applicable: true, maturity }));

describe("scoreAssessment", () => {
  it("da 100 con madurez 4 en todos los controles", () => {
    const r = scoreAssessment(fw, all(4));
    expect(r.overallScore).toBe(100);
    expect(r.gaps).toHaveLength(0);
  });

  it("da 0 con madurez 0 y lista 93 brechas", () => {
    const r = scoreAssessment(fw, all(0));
    expect(r.overallScore).toBe(0);
    expect(r.gaps).toHaveLength(93);
  });

  it("excluye del puntaje los controles no aplicables", () => {
    const answers = all(4).map((a, i) =>
      i === 0 ? { controlId: a.controlId, applicable: false, justification: "Sin desarrollo propio" } : a,
    );
    const r = scoreAssessment(fw, answers);
    expect(r.notApplicable).toBe(1);
    expect(r.applicable).toBe(92);
    expect(r.overallScore).toBe(100);
  });

  it("exige justificación para controles no aplicables", () => {
    expect(() => scoreAssessment(fw, [{ controlId: "A.5.1", applicable: false }])).toThrow();
  });

  it("cuenta como pendientes los controles sin evaluar", () => {
    const r = scoreAssessment(fw, [{ controlId: "A.5.1", applicable: true, maturity: 2 }]);
    expect(r.pending).toBe(92);
  });

  it("los pendientes no cuentan como 0: el puntaje es sobre lo evaluado y la cobertura lo aclara", () => {
    const r = scoreAssessment(fw, [{ controlId: "A.5.1", applicable: true, maturity: 2 }], 3);
    expect(r.overallScore).toBe(50);
    expect(r.averageMaturity).toBe(2);
    expect(r.coverage).toBe(1.1); // 1 de 93
    expect(scoreAssessment(fw, []).averageMaturity).toBeNull();
  });

  it("distribución por nivel, controles que alcanzan el objetivo y promedio por dominio", () => {
    const answers: Answer[] = [
      { controlId: "A.5.1", applicable: true, maturity: 0 },
      { controlId: "A.5.2", applicable: true, maturity: 3 },
      { controlId: "A.5.3", applicable: true, maturity: 4 },
      { controlId: "A.8.1", applicable: true, maturity: 1 },
    ];
    const r = scoreAssessment(fw, answers, 3);
    expect(r.distribution).toEqual([1, 1, 0, 1, 1]);
    expect(r.meetingTarget).toBe(2);
    expect(r.targetMaturity).toBe(3);
    const org = r.byDomain.find((d) => d.domain === "organizacional")!;
    expect(org).toMatchObject({ assessed: 3, average: 2.3, meetingTarget: 2, score: 58.3 });
    expect(r.byDomain.find((d) => d.domain === "fisico")).toMatchObject({ assessed: 0, average: null, score: 0 });
  });

  it("prioriza las brechas por tamaño (mayor primero) y las asocia a su dominio", () => {
    const r = scoreAssessment(
      fw,
      [
        { controlId: "A.8.1", applicable: true, maturity: 2 },
        { controlId: "A.5.1", applicable: true, maturity: 0 },
        { controlId: "A.5.2", applicable: true, maturity: 2 },
      ],
      3,
    );
    expect(r.gaps.map((g) => [g.controlId, g.gap, g.domain])).toEqual([
      ["A.5.1", 3, "organizacional"],
      ["A.5.2", 1, "organizacional"],
      ["A.8.1", 1, "tecnologico"],
    ]);
  });

  it("rechaza controles que no existen", () => {
    expect(() => scoreAssessment(fw, [{ controlId: "A.99.9", applicable: true, maturity: 1 }])).toThrow();
  });
});

describe("buildStatementOfApplicability", () => {
  it("genera una entrada por control", () => {
    expect(buildStatementOfApplicability(fw, [])).toHaveLength(93);
  });
});

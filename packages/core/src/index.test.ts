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

  it("rechaza controles que no existen", () => {
    expect(() => scoreAssessment(fw, [{ controlId: "A.99.9", applicable: true, maturity: 1 }])).toThrow();
  });
});

describe("buildStatementOfApplicability", () => {
  it("genera una entrada por control", () => {
    expect(buildStatementOfApplicability(fw, [])).toHaveLength(93);
  });
});

import { describe, expect, it } from "vitest";
import { answerProblem, isResolved, nextPending, percent, progressByDomain, statusOf } from "./assessment";
import type { Answer, Framework } from "./types";

const framework: Framework = {
  id: "fw",
  name: "Marco",
  version: "1",
  domains: { org: "Organizacionales", tec: "Tecnológicos" },
  controls: [
    { id: "A.5.1", domain: "org", title: "Políticas" },
    { id: "A.5.2", domain: "org", title: "Roles" },
    { id: "A.8.1", domain: "tec", title: "Dispositivos" },
  ],
};

describe("estado de un control", () => {
  it("pendiente, evaluado o no aplica", () => {
    expect(statusOf(undefined)).toBe("pending");
    expect(statusOf({ controlId: "A.5.1", applicable: true })).toBe("pending");
    expect(statusOf({ controlId: "A.5.1", applicable: true, maturity: 0 })).toBe("assessed");
    expect(statusOf({ controlId: "A.5.1", applicable: false, justification: "x" })).toBe("not_applicable");
    expect(isResolved({ controlId: "A.5.1", applicable: true, maturity: 0 })).toBe(true);
  });

  it("exige justificación si no aplica", () => {
    expect(answerProblem({ controlId: "A.5.1", applicable: false })).toMatch(/no aplica/);
    expect(answerProblem({ controlId: "A.5.1", applicable: false, justification: "   " })).toMatch(/no aplica/);
    expect(answerProblem({ controlId: "A.5.1", applicable: false, justification: "Sin oficinas" })).toBeNull();
    expect(answerProblem({ controlId: "A.5.1", applicable: true })).toBeNull();
    expect(answerProblem({ controlId: "A.5.1", applicable: true, justification: "x".repeat(2001) })).toMatch(/2000/);
  });
});

describe("avance", () => {
  const answers = new Map<string, Answer>([
    ["A.5.1", { controlId: "A.5.1", applicable: true, maturity: 2 }],
    ["A.8.1", { controlId: "A.8.1", applicable: false, justification: "x" }],
  ]);

  it("por dominio, en el orden del marco", () => {
    expect(progressByDomain(framework, answers)).toEqual([
      { domain: "org", label: "Organizacionales", resolved: 1, total: 2 },
      { domain: "tec", label: "Tecnológicos", resolved: 1, total: 1 },
    ]);
    expect(percent(1, 3)).toBe(33);
    expect(percent(0, 0)).toBe(0);
  });

  it("siguiente pendiente, dando la vuelta", () => {
    expect(nextPending(framework.controls, answers, null)?.id).toBe("A.5.2");
    expect(nextPending(framework.controls, answers, "A.8.1")?.id).toBe("A.5.2");
    const all = new Map(answers).set("A.5.2", { controlId: "A.5.2", applicable: true, maturity: 1 });
    expect(nextPending(framework.controls, all, "A.5.1")).toBeNull();
  });
});

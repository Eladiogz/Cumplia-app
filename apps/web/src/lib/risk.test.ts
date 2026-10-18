import { describe, expect, it } from "vitest";
import { byScore, filterRisks, isOverdue, levelIn, matrixCells, todayIso, type RiskFilters } from "./risk";
import type { Risk } from "./types";

const risk = (over: Partial<Risk>): Risk => ({
  id: crypto.randomUUID(),
  number: 1,
  title: "Riesgo",
  description: null,
  asset: null,
  threat: null,
  likelihood: 3,
  impact: 3,
  treatment: "mitigate",
  treatmentPlan: null,
  controlIds: [],
  residualLikelihood: null,
  residualImpact: null,
  status: "identified",
  ownerId: null,
  ownerName: null,
  ownerEmail: null,
  dueDate: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  ...over,
});

const none: RiskFilters = { query: "", level: "", status: "", cell: null, mode: "inherent" };

const phishing = risk({ number: 1, title: "Phishing a contabilidad", asset: "Correo", likelihood: 4, impact: 4, residualLikelihood: 2, residualImpact: 2 });
const nube = risk({ number: 2, title: "Caída del proveedor de nube", likelihood: 2, impact: 5, status: "in_treatment" });
const usb = risk({ number: 3, title: "Pérdida de USB", likelihood: 1, impact: 2, status: "closed" });

describe("riesgos en la web", () => {
  it("nivel inherente y residual", () => {
    expect(levelIn(phishing, "inherent")).toEqual({ score: 16, level: "high" });
    expect(levelIn(phishing, "residual")).toEqual({ score: 4, level: "low" });
    expect(levelIn(nube, "residual")).toBeNull();
  });

  it("agrupa por celda; sin residual no se ubica en la vista residual", () => {
    expect(matrixCells([phishing, nube, usb], "inherent").get("4-4")).toEqual([phishing]);
    const residual = matrixCells([phishing, nube, usb], "residual");
    expect([...residual.keys()]).toEqual(["2-2"]);
  });

  it("filtra por texto (sin acentos), código, nivel, estado y celda", () => {
    const all = [phishing, nube, usb];
    expect(filterRisks(all, { ...none, query: "perdida" })).toEqual([usb]);
    expect(filterRisks(all, { ...none, query: "R-002" })).toEqual([nube]);
    expect(filterRisks(all, { ...none, query: "correo" })).toEqual([phishing]);
    expect(filterRisks(all, { ...none, level: "high" })).toEqual([phishing, nube]);
    expect(filterRisks(all, { ...none, status: "closed" })).toEqual([usb]);
    expect(filterRisks(all, { ...none, cell: "2-5" })).toEqual([nube]);
    expect(filterRisks(all, { ...none, mode: "residual", level: "low" })).toEqual([phishing]);
  });

  it("ordena por puntaje y después por código", () => {
    expect([usb, nube, phishing].sort(byScore).map((r) => r.number)).toEqual([1, 2, 3]);
  });

  it("vencido solo si sigue abierto y pasó la fecha", () => {
    expect(isOverdue({ dueDate: "2026-10-01", status: "in_treatment" }, "2026-10-18")).toBe(true);
    expect(isOverdue({ dueDate: "2026-10-18", status: "identified" }, "2026-10-18")).toBe(false);
    expect(isOverdue({ dueDate: "2026-10-01", status: "closed" }, "2026-10-18")).toBe(false);
    expect(isOverdue({ dueDate: null, status: "identified" }, "2026-10-18")).toBe(false);
    expect(todayIso(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

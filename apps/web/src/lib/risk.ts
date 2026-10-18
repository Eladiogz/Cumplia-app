import { riskCode, riskLevel, riskScore, type RiskLevel, type RiskStatus } from "@cumplia/core/risk";
import type { Risk } from "./types";

/** Marco del que salen los controles que tratan riesgos. */
export const RISK_FRAMEWORK = "iso27001-2022";

export type MatrixMode = "inherent" | "residual";

/** Probabilidad e impacto según la vista (null: el riesgo no tiene residual evaluado). */
export function pointOf(r: Risk, mode: MatrixMode): { likelihood: number; impact: number } | null {
  if (mode === "inherent") return { likelihood: r.likelihood, impact: r.impact };
  if (r.residualLikelihood === null || r.residualImpact === null) return null;
  return { likelihood: r.residualLikelihood, impact: r.residualImpact };
}

export function levelIn(r: Risk, mode: MatrixMode): { score: number; level: RiskLevel } | null {
  const p = pointOf(r, mode);
  if (!p) return null;
  const score = riskScore(p.likelihood, p.impact);
  return { score, level: riskLevel(score) };
}

export const cellKey = (likelihood: number, impact: number) => `${likelihood}-${impact}`;

/** Riesgos de cada celda de la matriz. */
export function matrixCells(risks: Risk[], mode: MatrixMode): Map<string, Risk[]> {
  const cells = new Map<string, Risk[]>();
  for (const r of risks) {
    const p = pointOf(r, mode);
    if (!p) continue;
    const key = cellKey(p.likelihood, p.impact);
    cells.set(key, [...(cells.get(key) ?? []), r]);
  }
  return cells;
}

/** Hoy en formato AAAA-MM-DD (hora local). */
export const todayIso = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** Vencido: pasó la fecha límite y el riesgo sigue abierto (ni aceptado ni cerrado). */
const OPEN: RiskStatus[] = ["identified", "in_treatment"];
export const isOverdue = (r: Pick<Risk, "dueDate" | "status">, today = todayIso()) =>
  r.dueDate !== null && r.dueDate < today && OPEN.includes(r.status);

export interface RiskFilters {
  query: string;
  level: RiskLevel | "";
  status: RiskStatus | "";
  /** Celda elegida en la matriz (según la vista). */
  cell: string | null;
  mode: MatrixMode;
}

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filterRisks(risks: Risk[], f: RiskFilters): Risk[] {
  const q = normalize(f.query.trim());
  return risks.filter((r) => {
    if (q && ![riskCode(r.number), r.title, r.asset ?? "", r.threat ?? ""].some((s) => normalize(s).includes(q))) return false;
    if (f.status && r.status !== f.status) return false;
    const lvl = levelIn(r, f.mode);
    if (f.level && lvl?.level !== f.level) return false;
    if (f.cell) {
      const p = pointOf(r, f.mode);
      if (!p || cellKey(p.likelihood, p.impact) !== f.cell) return false;
    }
    return true;
  });
}

/** Mayor puntaje primero; a igual puntaje, el más antiguo (menor código). */
export const byScore = (a: Risk, b: Risk) =>
  riskScore(b.likelihood, b.impact) - riskScore(a.likelihood, a.impact) || a.number - b.number;

export const formatDueDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });

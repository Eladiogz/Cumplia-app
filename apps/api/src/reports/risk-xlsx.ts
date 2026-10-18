import writeXlsxFile, { type Row, type Sheet } from "write-excel-file/node";
import {
  IMPACT_LEVELS,
  LIKELIHOOD_LEVELS,
  RISK_LEVEL_LABEL,
  RISK_STATUS_LABEL,
  RISK_TREATMENT_LABEL,
  riskCode,
  riskLevel,
  riskScore,
  type RiskLevel,
  type RiskStatus,
  type RiskTreatment,
} from "@cumplia/core/risk";
import { formatDateTime } from "./soa-data.js";
import { header, num, text } from "./xlsx-cells.js";

export interface RiskRow {
  number: number;
  title: string;
  description: string | null;
  asset: string | null;
  threat: string | null;
  likelihood: number;
  impact: number;
  treatment: RiskTreatment;
  treatmentPlan: string | null;
  controlIds: string[];
  residualLikelihood: number | null;
  residualImpact: number | null;
  status: RiskStatus;
  ownerName: string | null;
  ownerEmail: string | null;
  dueDate: string | null;
  updatedAt: Date;
}

export interface RiskRegisterReport {
  organizationName: string;
  generatedAt: Date;
  generatedBy: string;
  risks: RiskRow[];
}

/** Fondo suave por nivel: el texto del nivel siempre acompaña al color. */
const LEVEL_FILL: Record<RiskLevel, string> = {
  low: "#DDEFD9",
  medium: "#FFF1C2",
  high: "#FAD9BF",
  critical: "#F4C7C7",
};

const levelOf = (l: number, i: number) => riskLevel(riskScore(l, i));
const owner = (r: RiskRow) => (r.ownerEmail ? (r.ownerName ? `${r.ownerName} <${r.ownerEmail}>` : r.ownerEmail) : "");

export const riskFileName = (r: Pick<RiskRegisterReport, "generatedAt">) =>
  `Registro de riesgos - ${r.generatedAt.toISOString().slice(0, 10)}.xlsx`;

/** Excel del registro de riesgos: Resumen (con la matriz 5×5) y Riesgos (tabla filtrable). */
export async function riskRegisterToXlsx(report: RiskRegisterReport): Promise<Buffer> {
  const { risks } = report;
  const count = (level: RiskLevel, residual = false) =>
    risks.filter((r) =>
      residual
        ? r.residualLikelihood !== null && r.residualImpact !== null && levelOf(r.residualLikelihood, r.residualImpact) === level
        : levelOf(r.likelihood, r.impact) === level,
    ).length;
  const levels: RiskLevel[] = ["critical", "high", "medium", "low"];

  const summary: Row[] = [
    [text("Registro de riesgos — ISO/IEC 27001:2022 (6.1.2 y 6.1.3)", { fontWeight: "bold", fontSize: 14 })],
    [],
    [text("Organización", { fontWeight: "bold" }), text(report.organizationName)],
    [text("Generado", { fontWeight: "bold" }), text(formatDateTime(report.generatedAt))],
    [text("Por", { fontWeight: "bold" }), text(report.generatedBy)],
    [text("Riesgos registrados", { fontWeight: "bold" }), num(risks.length, { align: "left" })],
    [],
    [header("Nivel"), header("Inherente"), header("Residual")],
    ...levels.map((l): Row => [text(RISK_LEVEL_LABEL[l], { backgroundColor: LEVEL_FILL[l] }), num(count(l)), num(count(l, true))]),
    [],
    [text("Matriz de riesgo inherente (cantidad de riesgos)", { fontWeight: "bold" })],
    [header("Impacto ↓ / Probabilidad →"), ...LIKELIHOOD_LEVELS.map((p) => header(`${p.value} · ${p.label}`))],
    ...[...IMPACT_LEVELS].reverse().map((i): Row => [
      text(`${i.value} · ${i.label}`, { fontWeight: "bold" }),
      ...LIKELIHOOD_LEVELS.map((p) => {
        const level = levelOf(p.value, i.value);
        const n = risks.filter((r) => r.likelihood === p.value && r.impact === i.value).length;
        return text(`${n > 0 ? n : "–"} (${RISK_LEVEL_LABEL[level]})`, { backgroundColor: LEVEL_FILL[level], align: "center" });
      }),
    ]),
  ];

  const table: Row[] = [
    [
      "Código",
      "Riesgo",
      "Descripción",
      "Activo",
      "Amenaza / vulnerabilidad",
      "Probabilidad",
      "Impacto",
      "Puntaje",
      "Nivel",
      "Tratamiento",
      "Plan / justificación",
      "Controles (Anexo A)",
      "Prob. residual",
      "Impacto residual",
      "Puntaje residual",
      "Nivel residual",
      "Estado",
      "Responsable",
      "Fecha límite",
      "Actualizado",
    ].map(header),
    ...risks.map((r): Row => {
      const level = levelOf(r.likelihood, r.impact);
      const hasResidual = r.residualLikelihood !== null && r.residualImpact !== null;
      const residual = hasResidual ? levelOf(r.residualLikelihood!, r.residualImpact!) : null;
      return [
        text(riskCode(r.number)),
        text(r.title),
        text(r.description ?? ""),
        text(r.asset ?? ""),
        text(r.threat ?? ""),
        num(r.likelihood),
        num(r.impact),
        num(riskScore(r.likelihood, r.impact)),
        text(RISK_LEVEL_LABEL[level], { backgroundColor: LEVEL_FILL[level] }),
        text(RISK_TREATMENT_LABEL[r.treatment]),
        text(r.treatmentPlan ?? ""),
        text(r.controlIds.join(", ")),
        hasResidual ? num(r.residualLikelihood!) : text(""),
        hasResidual ? num(r.residualImpact!) : text(""),
        hasResidual ? num(riskScore(r.residualLikelihood!, r.residualImpact!)) : text(""),
        residual ? text(RISK_LEVEL_LABEL[residual], { backgroundColor: LEVEL_FILL[residual] }) : text(""),
        text(RISK_STATUS_LABEL[r.status]),
        text(owner(r)),
        text(r.dueDate ?? ""),
        text(formatDateTime(r.updatedAt)),
      ];
    }),
  ];

  const sheets: Sheet<Buffer>[] = [
    { sheet: "Resumen", data: summary, columns: [{ width: 30 }, ...Array.from({ length: 5 }, () => ({ width: 20 }))] },
    {
      sheet: "Riesgos",
      data: table,
      stickyRowsCount: 1,
      orientation: "landscape",
      columns: [10, 36, 50, 24, 36, 12, 10, 10, 10, 13, 50, 22, 12, 12, 12, 12, 15, 32, 13, 18].map((width) => ({ width })),
    },
  ];
  return writeXlsxFile(sheets, { fontFamily: "Calibri", fontSize: 11 }).toBuffer();
}

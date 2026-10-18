import { MATURITY_LEVELS, type AssessmentResult, type SoaEntry } from "@cumplia/core";

/** Todo lo que necesita un reporte de la SoA (lo arma la ruta con datos de UNA organización). */
export interface SoaReport {
  organizationName: string;
  assessmentName: string;
  frameworkName: string;
  targetMaturity: number;
  generatedAt: Date;
  generatedBy: string;
  domains: Record<string, string>;
  /** Una entrada por control del marco, en su orden. */
  entries: (SoaEntry & { domain: string; evidenceCount: number })[];
  result: AssessmentResult;
}

export const COPYRIGHT_NOTE =
  "Los títulos de los controles se incluyen traducidos como referencia. El texto completo de ISO/IEC 27001 está protegido por derechos de autor de ISO.";

/** Estado de implementación de una entrada de la SoA, en palabras. */
export function implementationStatus(entry: Pick<SoaEntry, "applicable" | "maturity">): string {
  if (!entry.applicable) return "Excluido";
  if (entry.maturity === null) return "Sin evaluar";
  return `${entry.maturity} · ${MATURITY_LEVELS[entry.maturity]?.label ?? ""}`;
}

export const formatDateTime = (d: Date) =>
  d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

const formatNumber = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 1 });

/** Filas clave/valor del resumen (las usan el Excel y el PDF). */
export function summaryRows(r: SoaReport): [string, string][] {
  const { result } = r;
  const assessed = result.applicable - result.pending;
  return [
    ["Organización", r.organizationName],
    ["Evaluación", r.assessmentName],
    ["Marco", r.frameworkName],
    ["Madurez objetivo", `${r.targetMaturity} · ${MATURITY_LEVELS[r.targetMaturity]?.label ?? ""}`],
    ["Controles aplicables (incluidos)", String(result.applicable)],
    ["Controles excluidos", String(result.notApplicable)],
    ["Evaluados", `${assessed} de ${result.applicable} (${formatNumber(result.coverage)}%)`],
    ["Puntaje de madurez", assessed ? `${formatNumber(result.overallScore)}% (sobre lo evaluado)` : "—"],
    ["Madurez promedio", result.averageMaturity !== null ? `${formatNumber(result.averageMaturity)} de 4` : "—"],
    ["Alcanzan el objetivo", `${result.meetingTarget} de ${assessed}`],
    ["Brechas", String(result.gaps.length)],
    ["Generado", formatDateTime(r.generatedAt)],
    ["Generado por", r.generatedBy],
  ];
}

/** Nombre de archivo: "SoA - <evaluación> - AAAA-MM-DD.<ext>". */
export function reportFileName(r: Pick<SoaReport, "assessmentName" | "generatedAt">, extension: "pdf" | "xlsx") {
  const date = r.generatedAt.toISOString().slice(0, 10);
  const name = r.assessmentName.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 80) || "Evaluacion";
  return `SoA - ${name} - ${date}.${extension}`;
}

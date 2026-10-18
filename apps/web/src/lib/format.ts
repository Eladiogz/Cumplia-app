/** Números en formato argentino: coma decimal, sin decimales de más. */
export const formatNumber = (value: number, decimals = 1) =>
  value.toLocaleString("es-AR", { maximumFractionDigits: decimals });

export const formatPercent = (value: number) => `${formatNumber(value)}%`;

/** "Controles organizacionales" → "Organizacionales" (en gráficos y tablas el contexto ya lo dice). */
export function shortDomain(label: string) {
  const short = label.replace(/^Controles\s+/i, "");
  return short.charAt(0).toUpperCase() + short.slice(1);
}

/** Severidad de una brecha según cuántos niveles faltan para el objetivo. */
export type GapSeverity = "critical" | "serious" | "warning";

export function gapSeverity(gap: number): GapSeverity {
  if (gap >= 3) return "critical";
  if (gap === 2) return "serious";
  return "warning";
}

export const GAP_LABEL: Record<GapSeverity, string> = {
  critical: "Crítica",
  serious: "Alta",
  warning: "Media",
};

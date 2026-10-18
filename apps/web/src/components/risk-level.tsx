import { AlertOctagon, AlertTriangle, CheckCircle2, CircleAlert } from "lucide-react";
import { RISK_LEVEL_LABEL, type RiskLevel } from "@cumplia/core/risk";
import { cn } from "@/lib/utils";

export const LEVEL_ICON = { critical: AlertOctagon, high: AlertTriangle, medium: CircleAlert, low: CheckCircle2 } as const;

export const LEVEL_ICON_COLOR: Record<RiskLevel, string> = {
  critical: "text-destructive",
  high: "text-serious",
  medium: "text-warning",
  low: "text-success",
};

/** Nivel de riesgo: siempre ícono + etiqueta (y el puntaje si se pasa), nunca solo color. */
export function RiskLevelBadge({ level, score, className }: { level: RiskLevel; score?: number; className?: string }) {
  const Icon = LEVEL_ICON[level];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium", className)}>
      <Icon className={cn("size-3.5 shrink-0", LEVEL_ICON_COLOR[level])} aria-hidden />
      {RISK_LEVEL_LABEL[level]}
      {score !== undefined && <span className="tabular-nums text-muted-foreground">({score})</span>}
    </span>
  );
}

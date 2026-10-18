/**
 * Evaluación de riesgos (ISO/IEC 27001 cláusulas 6.1.2 y 6.1.3): matriz 5×5 de
 * probabilidad × impacto. Sin dependencias: se usa también en el navegador.
 */

export const LIKELIHOOD_LEVELS = [
  { value: 1, label: "Rara", description: "Podría ocurrir solo en circunstancias excepcionales (menos de una vez cada 5 años)." },
  { value: 2, label: "Improbable", description: "No se espera que ocurra, pero es posible (una vez cada 2 a 5 años)." },
  { value: 3, label: "Posible", description: "Podría ocurrir alguna vez (aproximadamente una vez al año)." },
  { value: 4, label: "Probable", description: "Es probable que ocurra varias veces al año." },
  { value: 5, label: "Casi segura", description: "Se espera que ocurra con frecuencia (mensual o más)." },
] as const;

export const IMPACT_LEVELS = [
  { value: 1, label: "Insignificante", description: "Sin efecto apreciable en la operación, los clientes ni el cumplimiento." },
  { value: 2, label: "Menor", description: "Afecta poco y se corrige rápido con recursos propios." },
  { value: 3, label: "Moderado", description: "Interrumpe procesos o expone información interna; requiere gestión específica." },
  { value: 4, label: "Mayor", description: "Fuga de datos de clientes, sanción o interrupción prolongada de servicios clave." },
  { value: 5, label: "Catastrófico", description: "Amenaza la continuidad del negocio o genera daño legal/reputacional grave." },
] as const;

export type RiskLevel = "low" | "medium" | "high" | "critical";

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
  critical: "Crítico",
};

export const RISK_LEVELS: RiskLevel[] = ["low", "medium", "high", "critical"];

/** Puntaje 1-25 = probabilidad × impacto. */
export const riskScore = (likelihood: number, impact: number) => likelihood * impact;

/** Nivel según el puntaje: Bajo ≤ 4 · Medio ≤ 9 · Alto ≤ 16 · Crítico > 16. */
export function riskLevel(score: number): RiskLevel {
  if (score <= 4) return "low";
  if (score <= 9) return "medium";
  if (score <= 16) return "high";
  return "critical";
}

export const RISK_TREATMENTS = ["mitigate", "accept", "transfer", "avoid"] as const;
export type RiskTreatment = (typeof RISK_TREATMENTS)[number];

export const RISK_TREATMENT_LABEL: Record<RiskTreatment, string> = {
  mitigate: "Mitigar",
  accept: "Aceptar",
  transfer: "Transferir",
  avoid: "Evitar",
};

export const RISK_TREATMENT_DESCRIPTION: Record<RiskTreatment, string> = {
  mitigate: "Aplicar controles para bajar la probabilidad o el impacto.",
  accept: "Asumir el riesgo tal como está, con una decisión justificada del responsable.",
  transfer: "Compartirlo con un tercero (seguro, proveedor, contrato).",
  avoid: "Dejar la actividad que origina el riesgo.",
};

export const RISK_STATUSES = ["identified", "in_treatment", "accepted", "closed"] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];

export const RISK_STATUS_LABEL: Record<RiskStatus, string> = {
  identified: "Identificado",
  in_treatment: "En tratamiento",
  accepted: "Aceptado",
  closed: "Cerrado",
};

/** Lo que hace falta para decidir si un riesgo es coherente. */
export interface RiskDecision {
  treatment: RiskTreatment;
  treatmentPlan?: string | null;
  status: RiskStatus;
  residualLikelihood?: number | null;
  residualImpact?: number | null;
}

/**
 * Reglas entre campos (null = coherente). Aceptar un riesgo es una decisión que
 * debe quedar justificada (ISO/IEC 27001 6.1.3 f: aprobación del riesgo residual).
 */
export function riskProblem(r: RiskDecision): string | null {
  if (r.treatment === "accept" && !r.treatmentPlan?.trim()) {
    return "Para aceptar un riesgo, escribí la justificación de la decisión";
  }
  if (r.status === "accepted" && r.treatment !== "accept") {
    return "Solo un riesgo con tratamiento «Aceptar» puede quedar en estado Aceptado";
  }
  if ((r.residualLikelihood == null) !== (r.residualImpact == null)) {
    return "El riesgo residual necesita probabilidad e impacto (o ninguno de los dos)";
  }
  return null;
}

/** Código visible del riesgo: R-001, R-002… */
export const riskCode = (number: number) => `R-${String(number).padStart(3, "0")}`;

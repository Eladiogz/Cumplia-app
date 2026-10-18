import { z } from "zod";
import type { Framework } from "@cumplia/frameworks";

/** Escala de madurez: 0 inexistente · 1 inicial · 2 definido · 3 implementado · 4 medido y mejorado */
export { MATURITY_LABELS, MATURITY_LEVELS, type MaturityLevel } from "./maturity.js";

export const AnswerSchema = z
  .object({
    controlId: z.string(),
    applicable: z.boolean(),
    maturity: z.number().int().min(0).max(4).optional(),
    justification: z.string().max(2000).optional(),
  })
  .refine((a) => a.applicable || (a.justification ?? "").trim().length > 0, {
    message: "Un control no aplicable requiere justificación (Declaración de Aplicabilidad)",
    path: ["justification"],
  });

export type Answer = z.infer<typeof AnswerSchema>;

export interface DomainScore {
  domain: string;
  label: string;
  applicable: number;
  assessed: number;
  /** 0-100 sobre los controles YA evaluados del dominio. */
  score: number;
  /** Madurez promedio 0-4 de lo evaluado (null si no hay nada evaluado). */
  average: number | null;
  /** Controles evaluados con madurez >= objetivo. */
  meetingTarget: number;
}

export interface Gap {
  controlId: string;
  title: string;
  domain: string;
  maturity: number;
  target: number;
  /** Niveles que faltan para el objetivo (prioridad: mayor brecha primero). */
  gap: number;
}

export interface AssessmentResult {
  frameworkId: string;
  targetMaturity: number;
  /**
   * 0-100 sobre los controles ya evaluados. Los pendientes NO cuentan como 0:
   * mientras falten controles el resultado es parcial (ver `coverage`).
   */
  overallScore: number;
  /** Madurez promedio 0-4 de lo evaluado (null si no hay nada evaluado). */
  averageMaturity: number | null;
  /** % de los controles aplicables que ya tienen madurez. */
  coverage: number;
  applicable: number;
  notApplicable: number;
  /** Aplicables sin evaluar. */
  pending: number;
  /** Evaluados con madurez >= objetivo. */
  meetingTarget: number;
  /** Cantidad de controles evaluados en cada nivel 0..4. */
  distribution: [number, number, number, number, number];
  byDomain: DomainScore[];
  /** Ordenadas por brecha (mayor primero) y luego por control. */
  gaps: Gap[];
}

const pct = (value: number, max: number) =>
  max === 0 ? 0 : Math.round((value / max) * 1000) / 10;
const oneDecimal = (value: number) => Math.round(value * 10) / 10;

export function scoreAssessment(
  framework: Framework,
  rawAnswers: Answer[],
  targetMaturity = 3,
): AssessmentResult {
  const answers = new Map<string, Answer>();
  for (const raw of rawAnswers) {
    const a = AnswerSchema.parse(raw);
    if (!framework.controls.some((c) => c.id === a.controlId)) {
      throw new Error(`Control inexistente en ${framework.id}: ${a.controlId}`);
    }
    answers.set(a.controlId, a);
  }

  let applicable = 0;
  let notApplicable = 0;
  let pending = 0;
  let assessed = 0;
  let total = 0;
  let meetingTarget = 0;
  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  const gaps: Gap[] = [];
  const acc = new Map<string, { applicable: number; assessed: number; sum: number; meetingTarget: number }>();

  for (const control of framework.controls) {
    const a = answers.get(control.id);
    const d = acc.get(control.domain) ?? { applicable: 0, assessed: 0, sum: 0, meetingTarget: 0 };
    acc.set(control.domain, d);

    if (a && !a.applicable) {
      notApplicable++;
      continue;
    }
    applicable++;
    d.applicable++;
    if (a?.maturity === undefined) {
      pending++;
      continue;
    }
    assessed++;
    d.assessed++;
    d.sum += a.maturity;
    total += a.maturity;
    distribution[a.maturity as 0 | 1 | 2 | 3 | 4]++;
    if (a.maturity >= targetMaturity) {
      meetingTarget++;
      d.meetingTarget++;
    } else {
      gaps.push({
        controlId: control.id,
        title: control.title,
        domain: control.domain,
        maturity: a.maturity,
        target: targetMaturity,
        gap: targetMaturity - a.maturity,
      });
    }
  }

  const byDomain: DomainScore[] = Object.entries(framework.domains).map(([domain, label]) => {
    const d = acc.get(domain) ?? { applicable: 0, assessed: 0, sum: 0, meetingTarget: 0 };
    return {
      domain,
      label,
      applicable: d.applicable,
      assessed: d.assessed,
      score: pct(d.sum, d.assessed * 4),
      average: d.assessed ? oneDecimal(d.sum / d.assessed) : null,
      meetingTarget: d.meetingTarget,
    };
  });

  gaps.sort((x, y) => y.gap - x.gap || x.controlId.localeCompare(y.controlId, undefined, { numeric: true }));

  return {
    frameworkId: framework.id,
    targetMaturity,
    overallScore: pct(total, assessed * 4),
    averageMaturity: assessed ? oneDecimal(total / assessed) : null,
    coverage: pct(assessed, applicable),
    applicable,
    notApplicable,
    pending,
    meetingTarget,
    distribution,
    byDomain,
    gaps,
  };
}

export interface SoaEntry {
  controlId: string;
  title: string;
  applicable: boolean;
  justification: string;
  maturity: number | null;
}

/** Declaración de Aplicabilidad (SoA) a partir de las respuestas. */
export function buildStatementOfApplicability(framework: Framework, answers: Answer[]): SoaEntry[] {
  const map = new Map(answers.map((a) => [a.controlId, a]));
  return framework.controls.map((c) => {
    const a = map.get(c.id);
    return {
      controlId: c.id,
      title: c.title,
      applicable: a?.applicable ?? true,
      justification: a?.justification ?? "",
      maturity: a?.maturity ?? null,
    };
  });
}

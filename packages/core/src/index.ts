import { z } from "zod";
import type { Framework } from "@cumplia/frameworks";

/** Escala de madurez: 0 inexistente · 1 inicial · 2 definido · 3 implementado · 4 medido y mejorado */
export const MATURITY_LABELS = [
  "No implementado",
  "Inicial",
  "Definido",
  "Implementado",
  "Medido y mejorado",
] as const;

export const AnswerSchema = z
  .object({
    controlId: z.string(),
    applicable: z.boolean(),
    maturity: z.number().int().min(0).max(4).optional(),
    justification: z.string().optional(),
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
  score: number; // 0-100
}

export interface Gap {
  controlId: string;
  title: string;
  maturity: number;
  target: number;
}

export interface AssessmentResult {
  frameworkId: string;
  overallScore: number; // 0-100
  applicable: number;
  notApplicable: number;
  pending: number; // aplicables sin evaluar
  byDomain: DomainScore[];
  gaps: Gap[]; // ordenadas de menor a mayor madurez
}

const pct = (value: number, max: number) =>
  max === 0 ? 0 : Math.round((value / max) * 1000) / 10;

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
  let total = 0;
  const gaps: Gap[] = [];
  const acc = new Map<string, { applicable: number; assessed: number; sum: number }>();

  for (const control of framework.controls) {
    const a = answers.get(control.id);
    const d = acc.get(control.domain) ?? { applicable: 0, assessed: 0, sum: 0 };
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
    d.assessed++;
    d.sum += a.maturity;
    total += a.maturity;
    if (a.maturity < targetMaturity) {
      gaps.push({ controlId: control.id, title: control.title, maturity: a.maturity, target: targetMaturity });
    }
  }

  const byDomain: DomainScore[] = Object.entries(framework.domains).map(([domain, label]) => {
    const d = acc.get(domain) ?? { applicable: 0, assessed: 0, sum: 0 };
    return { domain, label, applicable: d.applicable, assessed: d.assessed, score: pct(d.sum, d.applicable * 4) };
  });

  gaps.sort((x, y) => x.maturity - y.maturity || x.controlId.localeCompare(y.controlId, undefined, { numeric: true }));

  return {
    frameworkId: framework.id,
    overallScore: pct(total, applicable * 4),
    applicable,
    notApplicable,
    pending,
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

import type { Answer, Control, Framework } from "./types";

/** Estado de un control en el asistente. */
export type ControlStatus = "pending" | "assessed" | "not_applicable";

export function statusOf(answer: Answer | undefined): ControlStatus {
  if (!answer) return "pending";
  if (!answer.applicable) return "not_applicable";
  return answer.maturity === undefined || answer.maturity === null ? "pending" : "assessed";
}

/** Un control está resuelto si no aplica o si ya tiene madurez. */
export const isResolved = (answer: Answer | undefined) => statusOf(answer) !== "pending";

/** Lo que la API exige antes de guardar (la SoA necesita la justificación de lo excluido). */
export function answerProblem(answer: Answer): string | null {
  if (!answer.applicable && !answer.justification?.trim()) {
    return "Explicá por qué no aplica: queda registrado en la Declaración de Aplicabilidad.";
  }
  if ((answer.justification?.length ?? 0) > 2000) return "La justificación no puede superar los 2000 caracteres.";
  return null;
}

export interface DomainProgress {
  domain: string;
  label: string;
  resolved: number;
  total: number;
}

/** Avance por dominio, en el orden del marco. */
export function progressByDomain(framework: Framework, answers: Map<string, Answer>): DomainProgress[] {
  return Object.entries(framework.domains).map(([domain, label]) => {
    const controls = framework.controls.filter((c) => c.domain === domain);
    return { domain, label, total: controls.length, resolved: controls.filter((c) => isResolved(answers.get(c.id))).length };
  });
}

export const percent = (part: number, total: number) => (total === 0 ? 0 : Math.round((part / total) * 100));

/** Siguiente control sin resolver después de `currentId` (dando la vuelta), o null si no queda ninguno. */
export function nextPending(controls: Control[], answers: Map<string, Answer>, currentId: string | null): Control | null {
  const start = currentId ? controls.findIndex((c) => c.id === currentId) + 1 : 0;
  for (let i = 0; i < controls.length; i++) {
    const c = controls[(start + i) % controls.length]!;
    if (c.id !== currentId && !isResolved(answers.get(c.id))) return c;
  }
  return null;
}

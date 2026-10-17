/**
 * Escala de madurez 0-4 (inspirada en CMMI/COBIT), con descripciones propias para
 * guiar a quien evalúa. Sin dependencias: se usa también en el navegador.
 */
export const MATURITY_LEVELS = [
  {
    value: 0,
    label: "No implementado",
    description: "No existe el control o no se aplica en la práctica.",
  },
  {
    value: 1,
    label: "Inicial",
    description: "Se hace de manera informal o según la persona; no está documentado ni es consistente.",
  },
  {
    value: 2,
    label: "Definido",
    description: "Está documentado (política o procedimiento) pero su aplicación es parcial o irregular.",
  },
  {
    value: 3,
    label: "Implementado",
    description: "Documentado y aplicado de forma consistente; hay evidencia de que funciona.",
  },
  {
    value: 4,
    label: "Medido y mejorado",
    description: "Además se mide su eficacia, se revisa periódicamente y se mejora en función de los resultados.",
  },
] as const;

export type MaturityLevel = (typeof MATURITY_LEVELS)[number]["value"];

/** Solo las etiquetas, en orden 0-4. */
export const MATURITY_LABELS = MATURITY_LEVELS.map((l) => l.label) as readonly string[];

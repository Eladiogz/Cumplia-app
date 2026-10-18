import type { CellObject } from "write-excel-file/node";

// Los textos de usuarios se escriben como celdas de TEXTO: nunca se interpretan
// como fórmulas aunque empiecen con "=" (sin riesgo de inyección de fórmulas).

export const NAVY = "#1F3A5F";

export const header = (value: string): CellObject => ({
  value,
  type: String,
  fontWeight: "bold",
  textColor: "#FFFFFF",
  backgroundColor: NAVY,
  alignVertical: "center",
  wrap: true,
});

export const text = (value: string, extra: Partial<CellObject> = {}): CellObject => ({
  value,
  type: String,
  alignVertical: "top",
  wrap: true,
  ...extra,
});

export const num = (value: number, extra: Partial<CellObject> = {}): CellObject => ({
  value,
  type: Number,
  alignVertical: "top",
  align: "right",
  ...extra,
});

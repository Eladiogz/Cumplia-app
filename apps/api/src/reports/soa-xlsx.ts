import writeXlsxFile, { type Row, type Sheet } from "write-excel-file/node";
import { COPYRIGHT_NOTE, implementationStatus, summaryRows, type SoaReport } from "./soa-data.js";
import { header, num, text } from "./xlsx-cells.js";

/** Excel de la SoA: Resumen, Declaración de Aplicabilidad (tabla filtrable) y Brechas. */
export async function soaToXlsx(report: SoaReport): Promise<Buffer> {
  const summary: Row[] = [
    [text("Declaración de Aplicabilidad (SoA) — ISO/IEC 27001:2022", { fontWeight: "bold", fontSize: 14 })],
    [],
    ...summaryRows(report).map(([k, v]): Row => [text(k, { fontWeight: "bold" }), text(v)]),
    [],
    [header("Dominio"), header("Puntaje (%)"), header("Promedio (0-4)"), header("Evaluados"), header("Alcanzan el objetivo")],
    ...report.result.byDomain.map((d): Row => [
      text(d.label),
      d.assessed ? num(d.score) : text("—"),
      d.average !== null ? num(d.average) : text("—"),
      text(`${d.assessed} de ${d.applicable}`),
      num(d.meetingTarget),
    ]),
    [],
    [text(COPYRIGHT_NOTE, { fontStyle: "italic", textColor: "#555555" })],
  ];

  const soa: Row[] = [
    [
      header("Control"),
      header("Título"),
      header("Dominio"),
      header("Aplica"),
      header("Justificación (inclusión o exclusión)"),
      header("Estado de implementación"),
      header("Evidencias"),
    ],
    ...report.entries.map((e): Row => [
      text(e.controlId),
      text(e.title),
      text(report.domains[e.domain] ?? e.domain),
      text(e.applicable ? "Sí" : "No", { fontWeight: e.applicable ? undefined : "bold" }),
      text(e.justification || (e.applicable ? "" : "Sin justificación")),
      text(implementationStatus(e)),
      num(e.evidenceCount),
    ]),
  ];

  const gaps: Row[] = [
    [header("Control"), header("Título"), header("Dominio"), header("Madurez actual"), header("Objetivo"), header("Niveles que faltan")],
    ...report.result.gaps.map((g): Row => [
      text(g.controlId),
      text(g.title),
      text(report.domains[g.domain] ?? g.domain),
      num(g.maturity),
      num(g.target),
      num(g.gap),
    ]),
  ];

  const sheets: Sheet<Buffer>[] = [
    { sheet: "Resumen", data: summary, columns: [{ width: 38 }, { width: 46 }, { width: 16 }, { width: 14 }, { width: 20 }] },
    {
      sheet: "Declaración de Aplicabilidad",
      data: soa,
      stickyRowsCount: 1,
      orientation: "landscape",
      columns: [{ width: 10 }, { width: 46 }, { width: 26 }, { width: 8 }, { width: 60 }, { width: 24 }, { width: 11 }],
    },
    {
      sheet: "Brechas",
      data: gaps,
      stickyRowsCount: 1,
      columns: [{ width: 10 }, { width: 50 }, { width: 26 }, { width: 15 }, { width: 10 }, { width: 17 }],
    },
  ];
  return writeXlsxFile(sheets, { fontFamily: "Calibri", fontSize: 11 }).toBuffer();
}

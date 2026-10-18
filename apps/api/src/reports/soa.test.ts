import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { buildStatementOfApplicability, scoreAssessment, type Answer } from "@cumplia/core";
import { loadFramework } from "@cumplia/frameworks";
import { implementationStatus, reportFileName, type SoaReport } from "./soa-data.js";
import { soaToPdf } from "./soa-pdf.js";
import { soaToXlsx } from "./soa-xlsx.js";

const fw = loadFramework("iso27001-2022");
const answers: Answer[] = [
  { controlId: "A.5.1", applicable: true, maturity: 2, justification: "Política en borrador, falta aprobación de la dirección." },
  { controlId: "A.7.1", applicable: false, justification: "Trabajo 100% remoto: sin oficinas propias ni perímetros físicos." },
  // Un texto de usuario que parece fórmula: debe quedar como texto.
  { controlId: "A.8.5", applicable: true, maturity: 4, justification: '=HYPERLINK("http://malo.example","clic")' },
  // Justificación larga: el PDF debe ajustar el texto, no cortarlo.
  { controlId: "A.8.16", applicable: true, maturity: 1, justification: "Monitoreo parcial. ".repeat(40) },
];

const report: SoaReport = {
  organizationName: "Estudio Contable Sur",
  assessmentName: "Gap 2026",
  frameworkName: fw.name,
  targetMaturity: 3,
  generatedAt: new Date("2026-10-17T15:30:00Z"),
  generatedBy: "Ana <ana@ejemplo.com>",
  domains: fw.domains,
  entries: buildStatementOfApplicability(fw, answers).map((e) => ({
    ...e,
    domain: fw.controls.find((c) => c.id === e.controlId)!.domain,
    evidenceCount: e.controlId === "A.5.1" ? 2 : 0,
  })),
  result: scoreAssessment(fw, answers, 3),
};

/** Todo el XML del .xlsx (es un ZIP) como texto, para buscar contenido. */
const xlsxText = (buf: Buffer) => {
  const files = unzipSync(new Uint8Array(buf));
  return { files, all: Object.values(files).map((f) => strFromU8(f)).join("\n") };
};

describe("SoA en Excel", () => {
  it("tiene las tres hojas y una fila por control", async () => {
    const { files, all } = xlsxText(await soaToXlsx(report));
    const workbook = strFromU8(files["xl/workbook.xml"]!);
    for (const sheet of ["Resumen", "Declaración de Aplicabilidad", "Brechas"]) expect(workbook).toContain(`name="${sheet}"`);
    for (const c of fw.controls) expect(all).toContain(`>${c.id}<`);
    expect(all).toContain("Trabajo 100% remoto");
    expect(all).toContain("Estudio Contable Sur");
  });

  it("un texto que empieza con = queda como texto, nunca como fórmula", async () => {
    const { files } = xlsxText(await soaToXlsx(report));
    const sheets = Object.entries(files).filter(([name]) => name.startsWith("xl/worksheets/")).map(([, f]) => strFromU8(f));
    expect(sheets.join("")).not.toContain("<f>");
  });
});

describe("SoA en PDF", () => {
  it("genera un PDF de varias páginas sin cortar textos largos", async () => {
    const pdf = await soaToPdf(report, { compress: false });
    const raw = pdf.toString("latin1");
    expect(raw.startsWith("%PDF-")).toBe(true);
    expect(raw.trimEnd().endsWith("%%EOF")).toBe(true);
    const pages = raw.match(/\/Type \/Page\b/g)?.length ?? 0;
    expect(pages).toBeGreaterThanOrEqual(3); // 93 controles no entran en una página
    // El pie de página no debe agregar páginas en blanco: ~20 filas por página como mínimo.
    expect(pages).toBeLessThanOrEqual(8);
    const numbering = raw.match(/\/Type \/Pages[\s\S]*?\/Count (\d+)/);
    expect(Number(numbering?.[1])).toBe(pages);
  });
});

describe("datos del reporte", () => {
  it("estado de implementación en palabras", () => {
    expect(implementationStatus({ applicable: false, maturity: null })).toBe("Excluido");
    expect(implementationStatus({ applicable: true, maturity: null })).toBe("Sin evaluar");
    expect(implementationStatus({ applicable: true, maturity: 3 })).toBe("3 · Implementado");
  });

  it("nombre de archivo con fecha y sin caracteres inválidos", () => {
    expect(reportFileName({ assessmentName: 'Gap: "2026"/Q4', generatedAt: new Date("2026-10-17T15:00:00Z") }, "pdf")).toBe(
      "SoA - Gap 2026Q4 - 2026-10-17.pdf",
    );
  });
});

import PDFDocument from "pdfkit";
import { COPYRIGHT_NOTE, formatDateTime, implementationStatus, summaryRows, type SoaReport } from "./soa-data.js";

// PDF de la SoA: A4 apaisado, fuentes estándar (Helvetica: incluyen tildes, ñ, ¿ y ¡),
// tabla agrupada por dominio con el encabezado repetido en cada página y numeración.

const NAVY = "#1F3A5F";
const INK = "#1A1A1A";
const MUTED = "#5A5A5A";
const ZEBRA = "#F4F6F9";
const RULE = "#D9DCE1";

const MARGIN = 36;
const FONT = 8;
const PAD = 4;

/** Columnas de la tabla (anchos en puntos; la última toma el resto). */
const COLUMNS = [
  { key: "controlId", title: "Control", width: 48 },
  { key: "title", title: "Título", width: 200 },
  { key: "applicable", title: "Aplica", width: 38 },
  { key: "status", title: "Estado de implementación", width: 110 },
  { key: "evidence", title: "Evid.", width: 32 },
  { key: "justification", title: "Justificación (inclusión o exclusión)", width: 0 },
] as const;
type ColumnKey = (typeof COLUMNS)[number]["key"];

export function soaToPdf(report: SoaReport, { compress = true } = {}): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margins: { top: MARGIN, bottom: MARGIN + 14, left: MARGIN, right: MARGIN },
    bufferPages: true,
    compress,
    info: {
      Title: `Declaración de Aplicabilidad — ${report.assessmentName}`,
      Author: report.organizationName,
      Subject: "ISO/IEC 27001:2022 — Anexo A",
      Creator: "Cumplia",
    },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pageWidth = doc.page.width - MARGIN * 2;
  const widths = COLUMNS.map((c) => c.width || pageWidth - COLUMNS.reduce((sum, x) => sum + x.width, 0));
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  // ---- Encabezado y resumen ----
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(16).text("Declaración de Aplicabilidad (SoA)", MARGIN, MARGIN);
  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text("ISO/IEC 27001:2022 — Anexo A", { paragraphGap: 8 });

  const rows = summaryRows(report);
  const half = Math.ceil(rows.length / 2);
  const top = doc.y;
  const colWidth = pageWidth / 2;
  const LABEL = 170;
  let lowest = top;
  [rows.slice(0, half), rows.slice(half)].forEach((group, i) => {
    let y = top;
    for (const [k, v] of group) {
      // La fila mide lo que la más alta de sus dos celdas: nada se pisa aunque un texto ocupe 2 líneas.
      doc.font("Helvetica-Bold").fontSize(8.5);
      const labelHeight = doc.heightOfString(`${k}:`, { width: LABEL });
      doc.fillColor(INK).text(`${k}:`, MARGIN + i * colWidth, y, { width: LABEL });
      doc.font("Helvetica");
      const valueHeight = doc.heightOfString(v, { width: colWidth - LABEL - 12 });
      doc.text(v, MARGIN + i * colWidth + LABEL + 4, y, { width: colWidth - LABEL - 12 });
      y += Math.max(labelHeight, valueHeight, 11) + 2;
    }
    lowest = Math.max(lowest, y);
  });
  doc.y = lowest + 10;

  // ---- Tabla ----
  const cellText = (e: SoaReport["entries"][number], key: ColumnKey): string => {
    switch (key) {
      case "controlId":
        return e.controlId;
      case "title":
        return e.title;
      case "applicable":
        return e.applicable ? "Sí" : "No";
      case "status":
        return implementationStatus(e);
      case "evidence":
        return String(e.evidenceCount);
      case "justification":
        return e.justification || (e.applicable ? "" : "Sin justificación");
    }
  };

  const drawHeader = () => {
    const y = doc.y;
    doc.rect(MARGIN, y, pageWidth, 16).fill(NAVY);
    let x = MARGIN;
    doc.font("Helvetica-Bold").fontSize(FONT).fillColor("#FFFFFF");
    COLUMNS.forEach((c, i) => {
      doc.text(c.title, x + PAD, y + 4.5, { width: widths[i]! - PAD * 2, lineBreak: false, ellipsis: true });
      x += widths[i]!;
    });
    doc.y = y + 16;
  };

  /** Alto de una fila = la celda más alta (el texto se ajusta, nunca se corta). */
  const rowHeight = (values: string[]) => {
    doc.font("Helvetica").fontSize(FONT);
    return Math.max(...values.map((v, i) => doc.heightOfString(v || " ", { width: widths[i]! - PAD * 2 }))) + PAD * 2;
  };

  const newPageIfNeeded = (height: number) => {
    if (doc.y + height > bottom()) {
      doc.addPage();
      doc.y = MARGIN;
      drawHeader();
    }
  };

  drawHeader();
  let zebra = false;
  for (const [domain, label] of Object.entries(report.domains)) {
    const entries = report.entries.filter((e) => e.domain === domain);
    if (entries.length === 0) continue;
    // El título de dominio nunca queda solo al pie: necesita lugar para al menos una fila.
    newPageIfNeeded(18 + rowHeight(COLUMNS.map((c) => cellText(entries[0]!, c.key))));
    doc.font("Helvetica-Bold").fontSize(9).fillColor(NAVY).text(`${label} (${entries.length})`, MARGIN + PAD, doc.y + 5);
    doc.y += 4;
    for (const e of entries) {
      const values = COLUMNS.map((c) => cellText(e, c.key));
      const h = rowHeight(values);
      newPageIfNeeded(h);
      const y = doc.y;
      if (zebra) doc.rect(MARGIN, y, pageWidth, h).fill(ZEBRA);
      zebra = !zebra;
      let x = MARGIN;
      values.forEach((v, i) => {
        const bold = COLUMNS[i]!.key === "applicable" && !e.applicable;
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(FONT).fillColor(COLUMNS[i]!.key === "controlId" ? MUTED : INK);
        doc.text(v, x + PAD, y + PAD, { width: widths[i]! - PAD * 2 });
        x += widths[i]!;
      });
      doc.moveTo(MARGIN, y + h).lineTo(MARGIN + pageWidth, y + h).lineWidth(0.5).strokeColor(RULE).stroke();
      doc.y = y + h;
    }
  }

  newPageIfNeeded(30);
  doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(MUTED).text(COPYRIGHT_NOTE, MARGIN, doc.y + 10, { width: pageWidth });

  // ---- Pie de página en todas las páginas ----
  // Se escribe dentro del margen inferior: sin bajarlo a 0, pdfkit lo tomaría como
  // desborde y agregaría una página en blanco por cada texto del pie.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    const y = doc.page.height - MARGIN + 6;
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
    doc.text(`${report.organizationName} · ${report.assessmentName} · Generado ${formatDateTime(report.generatedAt)} con Cumplia`, MARGIN, y, {
      width: pageWidth - 80,
      lineBreak: false,
      ellipsis: true,
    });
    doc.text(`Página ${i - range.start + 1} de ${range.count}`, MARGIN, y, { width: pageWidth, align: "right", lineBreak: false });
  }

  doc.end();
  return done;
}

import { describe, expect, it } from "vitest";
import { fileProblem, formatBytes, linkify } from "./evidence";

describe("archivos de evidencia", () => {
  it("acepta imágenes y PDF de hasta 10 MB", () => {
    expect(fileProblem({ type: "image/png", size: 1000 })).toBeNull();
    expect(fileProblem({ type: "application/pdf", size: 10 * 1024 * 1024 })).toBeNull();
    expect(fileProblem({ type: "image/svg+xml", size: 100 })).toMatch(/Formato/);
    expect(fileProblem({ type: "application/vnd.ms-excel", size: 100 })).toMatch(/Formato/);
    expect(fileProblem({ type: "image/png", size: 10 * 1024 * 1024 + 1 })).toMatch(/10 MB/);
    expect(fileProblem({ type: "image/png", size: 0 })).toMatch(/vacío/);
  });

  it("muestra tamaños legibles", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1,5 MB");
  });
});

describe("links en las notas de evidencia", () => {
  it("convierte URLs http(s) en links, sin la puntuación final", () => {
    expect(linkify("Ver https://intranet.ejemplo.com/politica.pdf.")).toEqual([
      { text: "Ver " },
      { href: "https://intranet.ejemplo.com/politica.pdf", text: "https://intranet.ejemplo.com/politica.pdf" },
      { text: "." },
    ]);
  });

  it("no convierte esquemas peligrosos", () => {
    expect(linkify("javascript:alert(1)")).toEqual([{ text: "javascript:alert(1)" }]);
    expect(linkify("data:text/html,<script>")).toEqual([{ text: "data:text/html,<script>" }]);
  });

  it("texto sin links queda igual", () => {
    expect(linkify("Política aprobada en marzo")).toEqual([{ text: "Política aprobada en marzo" }]);
  });
});

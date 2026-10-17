import { describe, expect, it } from "vitest";
import { contentDisposition, detectFileType, safeFileName, sha256 } from "./files.js";

const bytes = (...values: number[]) => Buffer.from(values);
const PNG = Buffer.concat([bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), Buffer.alloc(32, 1)]);
const JPEG = Buffer.concat([bytes(0xff, 0xd8, 0xff, 0xe0), Buffer.alloc(32, 1)]);
const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n");
const WEBP = Buffer.concat([Buffer.from("RIFF"), bytes(0, 0, 0, 0), Buffer.from("WEBPVP8 "), Buffer.alloc(16)]);

describe("detección del tipo real de archivo", () => {
  it("reconoce PNG, JPEG, WebP y PDF por sus primeros bytes", () => {
    expect(detectFileType(PNG)?.contentType).toBe("image/png");
    expect(detectFileType(JPEG)?.contentType).toBe("image/jpeg");
    expect(detectFileType(WEBP)?.contentType).toBe("image/webp");
    expect(detectFileType(PDF)?.contentType).toBe("application/pdf");
  });

  it("rechaza todo lo demás, aunque se haga pasar por imagen", () => {
    expect(detectFileType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(detectFileType(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(detectFileType(Buffer.from("MZ\x90\x00 ejecutable de Windows"))).toBeNull();
    expect(detectFileType(Buffer.from("RIFF0000AVI LIST"))).toBeNull();
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
  });
});

describe("nombres de archivo", () => {
  const png = { contentType: "image/png", extension: "png" } as const;

  it("quita rutas y caracteres peligrosos, y fuerza la extensión real", () => {
    expect(safeFileName("../../etc/passwd", png)).toBe("passwd.png");
    expect(safeFileName("C:\\Users\\ana\\Captura de pantalla.exe", png)).toBe("Captura de pantalla.png");
    expect(safeFileName('a<b>:"c"|?*\u0000.png', png)).toBe("abc.png");
    expect(safeFileName(undefined, png)).toBe("evidencia.png");
    expect(safeFileName("x".repeat(300), png)).toHaveLength(104);
  });

  it("Content-Disposition con versión ASCII y UTF-8", () => {
    const header = contentDisposition('Política "MFA" año 2026.pdf');
    expect(header).toContain('filename="Politica _MFA_ ano 2026.pdf"');
    expect(header).toContain("filename*=UTF-8''Pol%C3%ADtica%20%22MFA%22%20a%C3%B1o%202026.pdf");
  });

  it("huella SHA-256", () => {
    expect(sha256(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

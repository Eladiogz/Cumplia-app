import { describe, expect, it } from "vitest";
import { listFrameworks, loadFramework } from "./index.js";

describe("ISO 27001:2022 Anexo A", () => {
  const fw = loadFramework("iso27001-2022");

  it("contiene los 93 controles", () => {
    expect(fw.controls).toHaveLength(93);
  });

  it("respeta la distribución 37/8/14/34 por dominio", () => {
    const count = (d: string) => fw.controls.filter((c) => c.domain === d).length;
    expect(count("organizacional")).toBe(37);
    expect(count("personas")).toBe(8);
    expect(count("fisico")).toBe(14);
    expect(count("tecnologico")).toBe(34);
  });

  it("falla con marcos desconocidos", () => {
    expect(() => loadFramework("no-existe")).toThrow();
    expect(listFrameworks()).toContain("iso27001-2022");
  });
});

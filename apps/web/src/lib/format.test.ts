import { describe, expect, it } from "vitest";
import { formatNumber, formatPercent, gapSeverity, shortDomain } from "./format";

describe("formato", () => {
  it("usa coma decimal y no muestra decimales de más", () => {
    expect(formatNumber(2.33)).toBe("2,3");
    expect(formatNumber(3)).toBe("3");
    expect(formatPercent(58.3)).toBe("58,3%");
    expect(formatPercent(100)).toBe("100%");
  });

  it("acorta el nombre del dominio", () => {
    expect(shortDomain("Controles organizacionales")).toBe("Organizacionales");
    expect(shortDomain("Controles de personas")).toBe("De personas");
    expect(shortDomain("Gestión")).toBe("Gestión");
  });

  it("severidad de la brecha por niveles faltantes", () => {
    expect(gapSeverity(4)).toBe("critical");
    expect(gapSeverity(3)).toBe("critical");
    expect(gapSeverity(2)).toBe("serious");
    expect(gapSeverity(1)).toBe("warning");
  });
});

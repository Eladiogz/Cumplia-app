import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTheme, themeCookie } from "./theme";

describe("tema", () => {
  it("solo acepta claro u oscuro; lo demás sigue al sistema", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("")).toBeNull();
    expect(parseTheme(undefined)).toBeNull();
    expect(parseTheme('dark"><script>')).toBeNull();
  });

  it("la cookie dura un año; volver al sistema la borra", () => {
    expect(themeCookie("dark")).toBe("cumplia_theme=dark; Path=/; SameSite=Lax; Max-Age=31536000");
    expect(themeCookie("system")).toBe("cumplia_theme=; Path=/; SameSite=Lax; Max-Age=0");
  });

  it("el tema oscuro elegido y el del sistema tienen exactamente los mismos colores", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    const block = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      expect(start, selector).toBeGreaterThan(-1);
      const body = css.slice(start + selector.length + 2, css.indexOf("}", start));
      return body
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean)
        .sort();
    };
    const chosen = block(':root[data-theme="dark"]');
    const system = block(":root:not([data-theme])");
    expect(system).toEqual(chosen);
    expect(chosen.length).toBeGreaterThan(30);
  });

  it("el tema oscuro redefine todos los colores del claro", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    const names = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      const body = css.slice(start, css.indexOf("}", start));
      return new Set([...body.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));
    };
    const light = names(":root");
    const dark = names(':root[data-theme="dark"]');
    const missing = [...light].filter((n) => n !== "--radius" && !dark.has(n));
    expect(missing).toEqual([]);
  });
});

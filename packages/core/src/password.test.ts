import { describe, expect, it } from "vitest";
import { checkPassword, commonCandidates, passwordStrength } from "./password.js";

const COMMON = new Set(["password", "dragon", "sunshine", "qwerty123"]);
const isCommon = (c: string) => COMMON.has(c);

describe("política de contraseñas", () => {
  it("acepta una contraseña larga con los cuatro tipos de caracteres", () => {
    expect(checkPassword("Mate-con-Bizcochos-7", {}, isCommon)).toEqual([]);
    expect(checkPassword("Río Paraná 2024 al atardecer!", {}, isCommon)).toEqual([]);
  });

  it("exige largo y composición", () => {
    expect(checkPassword("Ab1!")).toContain("length");
    expect(checkPassword("SOLO-MAYUSCULAS-123")).toContain("lowercase");
    expect(checkPassword("solo-minusculas-123")).toContain("uppercase");
    expect(checkPassword("Sin-Numeros-Ninguno")).toContain("digit");
    expect(checkPassword("SinSimbolosNinguno12")).toContain("symbol");
    expect(checkPassword("x".repeat(129))).toContain("length");
  });

  it("cuenta caracteres, no bytes, y reconoce letras con tilde y ñ", () => {
    expect(checkPassword("Ñandú-Ágil-2024")).toEqual([]);
  });

  it("rechaza repeticiones largas", () => {
    expect(checkPassword("Aaaaa-Bosque-2024")).toContain("repeated");
  });

  it("rechaza datos personales y el nombre del producto", () => {
    const ctx = { email: "maria.gonzalez@estudio.com", name: "María González", organizationName: "Estudio Contable Sur" };
    expect(checkPassword("Gonzalez#Segura-99", ctx)).toContain("personal");
    expect(checkPassword("Maria-Mi-Clave-2024", ctx)).toContain("personal");
    expect(checkPassword("Contable-Clave-2024!", ctx)).toContain("personal");
    expect(checkPassword("Mi-Cumplia-Segura-1")).toContain("common");
  });

  it("detecta contraseñas comunes aunque tengan relleno o leetspeak", () => {
    expect(commonCandidates("P@ssw0rd2024!")).toContain("password");
    expect(checkPassword("P@ssw0rd2024!", {}, isCommon)).toContain("common");
    expect(checkPassword("Sunshine2024!!", {}, isCommon)).toContain("common");
    expect(checkPassword("#Dr4g0n-2024", {}, isCommon)).toContain("common");
    expect(checkPassword("Qwerty123!aaB", {}, isCommon)).toContain("common");
  });

  it("el medidor premia el largo y castiga lo previsible", () => {
    expect(passwordStrength("")).toBe(0);
    expect(passwordStrength("Password123!")).toBe(0);
    expect(passwordStrength("corta")).toBeLessThanOrEqual(1);
    expect(passwordStrength("Mate-con-Bizcochos-7")).toBeGreaterThanOrEqual(3);
    expect(passwordStrength("Abcd-1234-Efgh")).toBeLessThan(passwordStrength("Mate-con-Bizcochos-7"));
  });
});

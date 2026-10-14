import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("API", () => {
  const app = buildApp();

  it("responde health", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
  });

  it("devuelve el marco ISO 27001 con 93 controles", async () => {
    const res = await app.inject({ method: "GET", url: "/frameworks/iso27001-2022" });
    expect(res.json().controls).toHaveLength(93);
  });

  it("404 con marco inexistente", async () => {
    const res = await app.inject({ method: "GET", url: "/frameworks/nada" });
    expect(res.statusCode).toBe(404);
  });

  it("calcula puntaje y SoA", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/frameworks/iso27001-2022/assessment",
      payload: { answers: [{ controlId: "A.5.1", applicable: true, maturity: 4 }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().soa).toHaveLength(93);
    expect(res.json().result.pending).toBe(92);
  });

  it("rechaza no aplicable sin justificación", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/frameworks/iso27001-2022/assessment",
      payload: { answers: [{ controlId: "A.5.1", applicable: false }] },
    });
    expect(res.statusCode).toBe(400);
  });
});

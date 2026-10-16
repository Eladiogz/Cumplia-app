import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOrganization } from "@cumplia/db";
import { createTestDb } from "@cumplia/db/testing";
import { buildApp } from "../app.js";
import { createDevTenantResolver, type TenantResolver } from "../tenant.js";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof buildApp>;
let orgA: string;
let orgB: string;

// Resolver de prueba: la organización viene en el header x-org.
const testResolver: TenantResolver = (req) => {
  const id = req.headers["x-org"];
  return typeof id === "string" ? { organizationId: id, actorId: null } : null;
};

beforeAll(async () => {
  ctx = await createTestDb();
  app = buildApp({ db: ctx.db, resolveTenant: testResolver });
  orgA = (await createOrganization(ctx.db, "A")).id;
  orgB = (await createOrganization(ctx.db, "B")).id;
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

const call = (method: "GET" | "POST" | "PUT", url: string, org: string | null, payload?: object) =>
  app.inject({ method, url, payload, headers: org ? { "x-org": org } : {} });

const createAssessment = async (org: string) =>
  (await call("POST", "/assessments", org, { frameworkId: "iso27001-2022" })).json().id as string;

describe("autenticación (falla cerrado)", () => {
  it("devuelve 401 sin tenant", async () => {
    expect((await call("GET", "/assessments", null)).statusCode).toBe(401);
    expect((await call("POST", "/assessments", null, { frameworkId: "iso27001-2022" })).statusCode).toBe(401);
    expect((await call("GET", "/audit-log", null)).statusCode).toBe(401);
  });

  it("sin resolver configurado, todo devuelve 401", async () => {
    const locked = buildApp({ db: ctx.db });
    const res = await locked.inject({ method: "GET", url: "/assessments", headers: { "x-org": orgA } });
    expect(res.statusCode).toBe(401);
    await locked.close();
  });

  it("las rutas sin estado siguen públicas", async () => {
    expect((await call("GET", "/frameworks", null)).statusCode).toBe(200);
  });
});

describe("evaluaciones", () => {
  it("crea (201), lista y obtiene una evaluación", async () => {
    const res = await call("POST", "/assessments", orgA, { frameworkId: "iso27001-2022" });
    expect(res.statusCode).toBe(201);
    const { id } = res.json();
    expect((await call("GET", "/assessments", orgA)).json().some((a: { id: string }) => a.id === id)).toBe(true);
    expect((await call("GET", `/assessments/${id}`, orgA)).statusCode).toBe(200);
  });

  it("guarda respuestas y calcula resultado y SoA", async () => {
    const id = await createAssessment(orgA);
    const put = await call("PUT", `/assessments/${id}/answers`, orgA, {
      answers: [
        { controlId: "A.5.1", applicable: true, maturity: 4 },
        { controlId: "A.7.1", applicable: false, justification: "Trabajo remoto" },
      ],
    });
    expect(put.json()).toEqual({ saved: 2 });
    const result = (await call("GET", `/assessments/${id}/result`, orgA)).json();
    expect(result.notApplicable).toBe(1);
    expect(result.applicable).toBe(92);
    const soa = (await call("GET", `/assessments/${id}/soa`, orgA)).json();
    expect(soa).toHaveLength(93);
    expect((await call("GET", `/assessments/${id}/answers`, orgA)).json()).toHaveLength(2);
  });

  it("registra evidencia y la auditoría", async () => {
    const id = await createAssessment(orgA);
    await call("PUT", `/assessments/${id}/answers`, orgA, {
      answers: [{ controlId: "A.8.5", applicable: true, maturity: 3 }],
    });
    const ev = await call("POST", `/assessments/${id}/evidence`, orgA, {
      controlId: "A.8.5",
      source: "manual",
      description: "MFA activo",
    });
    expect(ev.statusCode).toBe(201);
    const log = (await call("GET", "/audit-log", orgA)).json() as { action: string }[];
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["assessment.create", "answers.save", "evidence.add"]));
  });
});

describe("aislamiento entre organizaciones por HTTP", () => {
  it("la organización B no accede a datos de A", async () => {
    const id = await createAssessment(orgA);
    await call("PUT", `/assessments/${id}/answers`, orgA, {
      answers: [{ controlId: "A.5.1", applicable: true, maturity: 1 }],
    });
    for (const [method, url, body] of [
      ["GET", `/assessments/${id}`, undefined],
      ["GET", `/assessments/${id}/answers`, undefined],
      ["GET", `/assessments/${id}/result`, undefined],
      ["GET", `/assessments/${id}/soa`, undefined],
      ["PUT", `/assessments/${id}/answers`, { answers: [{ controlId: "A.5.1", applicable: true, maturity: 4 }] }],
      ["POST", `/assessments/${id}/evidence`, { controlId: "A.5.1", source: "x", description: "x" }],
    ] as const) {
      expect((await call(method, url, orgB, body)).statusCode, `${method} ${url}`).toBe(404);
    }
    const mine = (await call("GET", "/assessments", orgB)).json() as { id: string }[];
    expect(mine.some((a) => a.id === id)).toBe(false);
    const still = (await call("GET", `/assessments/${id}/answers`, orgA)).json();
    expect(still[0].maturity).toBe(1);
  });
});

describe("validación de entradas", () => {
  it("responde 400 ante datos inválidos", async () => {
    const id = await createAssessment(orgA);
    expect((await call("GET", "/assessments/no-es-uuid", orgA)).statusCode).toBe(400);
    expect((await call("POST", "/assessments", orgA, { frameworkId: "nada" })).statusCode).toBe(400);
    expect(
      (await call("PUT", `/assessments/${id}/answers`, orgA, { answers: [{ controlId: "A.5.1", applicable: false }] }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call("PUT", `/assessments/${id}/answers`, orgA, { answers: [{ controlId: "A.99.9", applicable: true, maturity: 1 }] }))
        .statusCode,
    ).toBe(400);
  });
});

describe("resolver de desarrollo", () => {
  it("solo acepta organizaciones existentes y UUID válidos", async () => {
    const resolver = createDevTenantResolver(ctx.db);
    const req = (h: Record<string, string>) => ({ headers: h }) as never;
    expect(await resolver(req({ "x-organization-id": orgA }))).toEqual({ organizationId: orgA, actorId: null });
    expect(await resolver(req({ "x-organization-id": "00000000-0000-4000-8000-000000000000" }))).toBeNull();
    expect(await resolver(req({ "x-organization-id": "basura" }))).toBeNull();
    expect(await resolver(req({}))).toBeNull();
  });
});

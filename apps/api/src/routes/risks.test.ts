import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { createSession, schema, type Role } from "@cumplia/db";
import { createTestDb } from "@cumplia/db/testing";
import { buildApp } from "../app.js";
import { SESSION_COOKIE, hashToken, newSessionToken, sessionExpiry } from "../security/session.js";
import { createSessionTenantResolver } from "../tenant.js";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof buildApp>;

const PASSWORD = "Clave-Segura-de-Prueba-2026";

beforeAll(async () => {
  ctx = await createTestDb();
  app = buildApp({
    db: ctx.db,
    resolveTenant: createSessionTenantResolver(ctx.db),
    authRateLimit: 1000,
    mfaEncryptionKey: randomBytes(32),
  });
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

let n = 0;
type Method = "GET" | "POST" | "PATCH" | "DELETE";
const call = (method: Method, url: string, cookie?: string, payload?: object) =>
  app.inject({ method, url, payload, headers: cookie ? { cookie } : {} });

const verify = (userId: string) => ctx.db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, userId));

const registerAdmin = async () => {
  const email = `riesgos${++n}@ejemplo.com`;
  const res = await call("POST", "/auth/register", undefined, { email, password: PASSWORD, organizationName: "Empresa" });
  const c = res.cookies.find((x) => x.name === SESSION_COOKIE)!;
  const body = res.json() as { user: { id: string }; organization: { id: string } };
  return { email, userId: body.user.id, orgId: body.organization.id, cookie: `${SESSION_COOKIE}=${c.value}` };
};

const addMember = async (orgId: string, role: Role) => {
  const other = await registerAdmin();
  await ctx.db.insert(schema.memberships).values({ userId: other.userId, organizationId: orgId, role });
  const token = newSessionToken();
  await createSession(ctx.db, { userId: other.userId, organizationId: orgId, tokenHash: hashToken(token), expiresAt: sessionExpiry() });
  return { ...other, cookie: `${SESSION_COOKIE}=${token}` };
};

const risk = { title: "Fuga de datos por phishing", likelihood: 4, impact: 4, controlIds: ["A.6.3", "A.8.7"] };

describe("registro de riesgos por API", () => {
  it("CONSULTANT crea y edita; AUDITOR solo lee; solo ADMIN borra", async () => {
    const admin = await registerAdmin();
    const consultant = await addMember(admin.orgId, "CONSULTANT");
    const auditor = await addMember(admin.orgId, "AUDITOR");

    const created = await call("POST", "/risks", consultant.cookie, { ...risk, ownerId: consultant.userId, dueDate: "2026-12-31" });
    expect(created.statusCode, created.body).toBe(201);
    const r = created.json() as { id: string; number: number; ownerEmail: string; dueDate: string };
    expect(r).toMatchObject({ number: 1, ownerEmail: consultant.email, dueDate: "2026-12-31" });

    const patched = await call("PATCH", `/risks/${r.id}`, consultant.cookie, { status: "in_treatment", residualLikelihood: 2, residualImpact: 3 });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json()).toMatchObject({ status: "in_treatment", residualLikelihood: 2, residualImpact: 3 });

    expect((await call("GET", "/risks", auditor.cookie)).json()).toHaveLength(1);
    expect((await call("GET", `/risks/${r.id}`, auditor.cookie)).statusCode).toBe(200);
    expect((await call("POST", "/risks", auditor.cookie, risk)).statusCode).toBe(403);
    expect((await call("PATCH", `/risks/${r.id}`, auditor.cookie, { status: "closed" })).statusCode).toBe(403);
    expect((await call("GET", "/risks/owners", auditor.cookie)).statusCode).toBe(403);

    expect((await call("DELETE", `/risks/${r.id}`, consultant.cookie)).statusCode).toBe(403);
    expect((await call("DELETE", `/risks/${r.id}`, admin.cookie)).statusCode).toBe(204);
    expect((await call("GET", `/risks/${r.id}`, admin.cookie)).statusCode).toBe(404);
  });

  it("valida el cuerpo y las reglas del riesgo", async () => {
    const admin = await registerAdmin();
    const bad = async (payload: object) => (await call("POST", "/risks", admin.cookie, { ...risk, ...payload })).statusCode;
    expect(await bad({ likelihood: 6 })).toBe(400);
    expect(await bad({ title: "   " })).toBe(400);
    expect(await bad({ dueDate: "31/12/2026" })).toBe(400);
    expect(await bad({ controlIds: ["A.99.1"] })).toBe(400);
    expect(await bad({ treatment: "accept" })).toBe(400);
    expect(await bad({ treatment: "accept", treatmentPlan: "Riesgo bajo frente al costo", status: "accepted" })).toBe(201);

    const { id } = (await call("POST", "/risks", admin.cookie, risk)).json() as { id: string };
    expect((await call("PATCH", `/risks/${id}`, admin.cookie, {})).statusCode).toBe(400);
    expect((await call("PATCH", `/risks/${id}`, admin.cookie, { number: 7 })).statusCode).toBe(400);
    expect((await call("PATCH", `/risks/${id}`, admin.cookie, { organizationId: admin.orgId })).statusCode).toBe(400);
  });

  it("no se puede asignar como responsable a alguien de otra organización", async () => {
    const a = await registerAdmin();
    const b = await registerAdmin();
    const res = await call("POST", "/risks", a.cookie, { ...risk, ownerId: b.userId });
    expect(res.statusCode).toBe(400);
    const owners = (await call("GET", "/risks/owners", a.cookie)).json() as { userId: string }[];
    expect(owners.map((o) => o.userId)).toEqual([a.userId]);
  });

  it("exporta a Excel con email verificado, como texto y auditado", async () => {
    const admin = await registerAdmin();
    const auditor = await addMember(admin.orgId, "AUDITOR");
    await call("POST", "/risks", admin.cookie, { ...risk, title: '=HYPERLINK("http://malo.example","clic")' });
    await call("POST", "/risks", admin.cookie, { ...risk, title: "Caída del proveedor de nube", likelihood: 2, impact: 5 });

    expect((await call("GET", "/risks.xlsx", auditor.cookie)).statusCode).toBe(403);
    await verify(auditor.userId);
    const res = await call("GET", "/risks.xlsx", auditor.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="Registro de riesgos - \d{4}-\d{2}-\d{2}\.xlsx"/);

    const files = unzipSync(new Uint8Array(res.rawPayload));
    const sheets = Object.entries(files).filter(([name]) => name.startsWith("xl/")).map(([, f]) => strFromU8(f)).join("\n");
    expect(sheets).toContain("Caída del proveedor de nube");
    expect(sheets).toContain("R-002");
    expect(sheets).toContain("Matriz de riesgo inherente");
    expect(sheets).not.toContain("<f>");

    const log = (await call("GET", "/audit-log", admin.cookie)).json() as { action: string; details: object }[];
    expect(log[0]).toMatchObject({ action: "risk.export", details: { format: "xlsx", risks: 2 } });
  });
});

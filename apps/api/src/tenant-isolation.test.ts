import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { forOrganization, schema } from "@cumplia/db";
import { createTestDb } from "@cumplia/db/testing";
import { buildApp } from "./app.js";
import { SESSION_COOKIE } from "./security/session.js";
import { createSessionTenantResolver } from "./tenant.js";

/**
 * Test de fuga entre organizaciones que se mantiene solo: descubre TODAS las rutas
 * protegidas al arrancar la app y, con una sesión de ADMIN de la organización B,
 * intenta leer y modificar los datos de A. Una ruta nueva queda cubierta sin tocar
 * este archivo (salvo que use un parámetro o un cuerpo que todavía no conoce).
 */

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof buildApp>;
const routes: { method: string; url: string }[] = [];

const PASSWORD = "Clave-Segura-de-Prueba-2026";

// Datos de la organización A que B nunca debe ver ni tocar.
const A = { orgId: "", assessmentId: "", memberId: "", memberEmail: "", adminEmail: "", invitationId: "", invitedEmail: "", evidenceId: "", riskId: "" };
let cookieA = "";
let cookieB = "";

/** Valor para cada parámetro de ruta: siempre un recurso de A. */
const PARAMS: Record<string, () => string> = {
  id: () => A.assessmentId,
  userId: () => A.memberId,
  invitationId: () => A.invitationId,
  evidenceId: () => A.evidenceId,
  riskId: () => A.riskId,
};

/** Cuerpos válidos: así la petición llega hasta la verificación de pertenencia (y no muere en un 400). */
const BODIES: Record<string, object> = {
  "PUT /assessments/:id/answers": { answers: [{ controlId: "A.5.1", applicable: true, maturity: 4 }] },
  "PATCH /assessments/:id": { name: "Renombrada por otra organización" },
  "POST /assessments/:id/evidence/files": {},
  "POST /assessments/:id/evidence": { controlId: "A.5.1", source: "manual", description: "intrusa" },
  "PATCH /members/:userId": { role: "AUDITOR" },
  "POST /members/:userId/password-reset": {},
  "POST /members/:userId/sessions/revoke": {},
  "PATCH /risks/:riskId": { status: "closed" },
};

const register = async (email: string, organizationName: string) => {
  const res = await app.inject({ method: "POST", url: "/auth/register", payload: { email, password: PASSWORD, organizationName } });
  const c = res.cookies.find((x) => x.name === SESSION_COOKIE)!;
  const body = res.json() as { user: { id: string }; organization: { id: string } };
  // Email verificado: así ninguna ruta corta antes con 403 y se prueba el aislamiento de verdad (404).
  await ctx.db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, body.user.id));
  return { body, cookie: `${SESSION_COOKIE}=${c.value}` };
};

const call = (method: string, url: string, cookie: string, payload?: object) =>
  app.inject({ method: method as "GET", url, payload, headers: { cookie } });

beforeAll(async () => {
  ctx = await createTestDb();
  app = buildApp({
    db: ctx.db,
    resolveTenant: createSessionTenantResolver(ctx.db),
    authRateLimit: 1000,
    mfaEncryptionKey: randomBytes(32),
  });
  // Se registra antes de que carguen los plugins: ve cada ruta que declara permiso.
  app.addHook("onRoute", (route) => {
    if (!route.config?.permission) return;
    for (const method of [route.method].flat()) {
      if (method !== "HEAD") routes.push({ method, url: route.url });
    }
  });
  await app.ready();

  A.adminEmail = "admin-a@ejemplo.com";
  const a = await register(A.adminEmail, "Organización A");
  A.orgId = a.body.organization.id;
  cookieA = a.cookie;

  const repoA = forOrganization(ctx.db, A.orgId, a.body.user.id);
  A.assessmentId = (await repoA.createAssessment("iso27001-2022")).id;
  await repoA.saveAnswers(A.assessmentId, [{ controlId: "A.5.1", applicable: true, maturity: 1 }]);
  A.evidenceId = (await repoA.addEvidence(A.assessmentId, "A.5.1", "manual", "evidencia de A")).id;

  // Un segundo miembro en A, para las rutas de miembros.
  A.memberEmail = "consultor-a@ejemplo.com";
  const member = await register(A.memberEmail, "Propia del consultor");
  A.memberId = member.body.user.id;
  await ctx.db.insert(schema.memberships).values({ userId: A.memberId, organizationId: A.orgId, role: "CONSULTANT" });

  A.invitedEmail = "invitada-a@ejemplo.com";
  const invitation = await repoA.createInvitation({
    email: A.invitedEmail,
    role: "AUDITOR",
    tokenHash: "hash-de-prueba-a",
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  A.invitationId = invitation.id;

  A.riskId = (await repoA.createRisk({ title: "Riesgo secreto de A", likelihood: 4, impact: 5, ownerId: A.memberId })).id;

  cookieB = (await register("admin-b@ejemplo.com", "Organización B")).cookie;
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

describe("aislamiento entre organizaciones en todas las rutas protegidas", () => {
  it("descubre las rutas (el test no es vacío)", () => {
    const keys = routes.map((r) => `${r.method} ${r.url}`);
    expect(keys).toEqual(
      expect.arrayContaining(["GET /assessments/:id", "PUT /assessments/:id/answers", "GET /audit-log", "DELETE /members/:userId"]),
    );
  });

  it("ninguna ruta con parámetros deja leer ni modificar un recurso de otra organización", async () => {
    for (const { method, url } of routes.filter((r) => r.url.includes(":"))) {
      const key = `${method} ${url}`;
      const path = url.replace(/:(\w+)/g, (_, name: string) => {
        const value = PARAMS[name];
        if (!value) throw new Error(`Parámetro ":${name}" desconocido en ${key}: agregalo a PARAMS`);
        return value();
      });
      const payload = ["GET", "DELETE"].includes(method) ? undefined : BODIES[key];
      if (!["GET", "DELETE"].includes(method) && !payload) throw new Error(`Falta un cuerpo válido para ${key} en BODIES`);

      const res = await call(method, path, cookieB, payload);
      expect(res.statusCode, `${key} devolvió ${res.statusCode}: ${res.body}`).toBe(404);
    }
  });

  it("los listados de B no contienen nada de A", async () => {
    const secrets = [A.orgId, A.assessmentId, A.memberId, A.memberEmail, A.adminEmail, A.invitationId, A.invitedEmail, "evidencia de A", A.riskId, "Riesgo secreto de A"];
    for (const { url } of routes.filter((r) => r.method === "GET" && !r.url.includes(":"))) {
      const res = await call("GET", url, cookieB);
      expect(res.statusCode, url).toBe(200);
      for (const s of secrets) expect(res.body, `${url} filtra ${s}`).not.toContain(s);
    }
  });

  it("después de todos los intentos, los datos de A siguen intactos", async () => {
    const answers = (await call("GET", `/assessments/${A.assessmentId}/answers`, cookieA)).json() as { maturity: number }[];
    expect(answers).toEqual([expect.objectContaining({ controlId: "A.5.1", maturity: 1 })]);
    const members = (await call("GET", "/members", cookieA)).json() as { userId: string; role: string }[];
    expect(members.find((m) => m.userId === A.memberId)?.role).toBe("CONSULTANT");
    const log = (await call("GET", "/audit-log", cookieA)).json() as { action: string }[];
    expect(log.map((l) => l.action)).not.toContain("member.remove");
    for (const action of ["invitation.revoke", "member.password_reset_sent", "member.sessions_revoked", "member.mfa_reset"]) {
      expect(log.map((l) => l.action)).not.toContain(action);
    }
    const risk = (await call("GET", `/risks/${A.riskId}`, cookieA)).json() as { status: string; title: string };
    expect(risk).toMatchObject({ status: "identified", title: "Riesgo secreto de A" });
    const pendingInvitations =(await call("GET", "/invitations", cookieA)).json() as { id: string }[];
    expect(pendingInvitations.map((i) => i.id)).toContain(A.invitationId);
  });
});

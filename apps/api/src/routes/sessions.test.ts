import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@cumplia/db";
import { createTestDb } from "@cumplia/db/testing";
import { buildApp } from "../app.js";
import { SESSION_COOKIE } from "../security/session.js";
import { createSessionTenantResolver } from "../tenant.js";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof buildApp>;

const PASSWORD = "Clave-Segura-de-Prueba-2026";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

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
type Method = "GET" | "POST" | "DELETE";
const call = (method: Method, url: string, cookie?: string, payload?: object) =>
  app.inject({ method, url, payload, headers: cookie ? { cookie } : {} });

const cookieOf = (res: { cookies: { name: string; value: string }[] }) =>
  `${SESSION_COOKIE}=${res.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;

const register = async () => {
  const email = `sesiones${++n}@ejemplo.com`;
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: PASSWORD, organizationName: `Empresa ${n}` },
    headers: { "user-agent": CHROME },
  });
  const body = res.json() as { user: { id: string }; organization: { id: string } };
  return { email, userId: body.user.id, orgId: body.organization.id, cookie: cookieOf(res) };
};

const login = async (email: string, userAgent: string) =>
  cookieOf(await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD }, headers: { "user-agent": userAgent } }));

interface SessionView {
  id: string;
  organizationName: string;
  userAgent: string | null;
  ipAddress: string | null;
  current: boolean;
}

describe("sesiones activas de la cuenta", () => {
  it("lista las propias con navegador, IP y organización, marcando la actual (sin el token)", async () => {
    const a = await register();
    const phone = await login(a.email, IPHONE);
    const res = await call("GET", "/auth/sessions", a.cookie);
    expect(res.statusCode).toBe(200);
    const list = res.json() as SessionView[];
    expect(list).toHaveLength(2);
    expect(list.find((s) => s.current)).toMatchObject({ userAgent: CHROME, organizationName: `Empresa ${n}` });
    expect(list.find((s) => !s.current)?.userAgent).toBe(IPHONE);
    expect(list[0]!.ipAddress).toBeTruthy();
    expect(res.body).not.toMatch(/token/i);
    expect((await call("GET", "/auth/sessions", phone)).json()).toHaveLength(2);
  });

  it("cierra una sesión propia; la actual se cierra con «Cerrar sesión»", async () => {
    const a = await register();
    const phone = await login(a.email, IPHONE);
    const list = (await call("GET", "/auth/sessions", a.cookie)).json() as SessionView[];
    const other = list.find((s) => !s.current)!;
    const current = list.find((s) => s.current)!;

    expect((await call("DELETE", `/auth/sessions/${current.id}`, a.cookie)).statusCode).toBe(400);
    expect((await call("DELETE", `/auth/sessions/${other.id}`, a.cookie)).statusCode).toBe(204);
    expect((await call("GET", "/auth/me", phone)).statusCode).toBe(401);
    expect((await call("GET", "/auth/me", a.cookie)).statusCode).toBe(200);
  });

  it("no puede ver ni cerrar sesiones de otra cuenta", async () => {
    const a = await register();
    const b = await register();
    const [sessionB] = (await call("GET", "/auth/sessions", b.cookie)).json() as SessionView[];
    expect((await call("DELETE", `/auth/sessions/${sessionB!.id}`, a.cookie)).statusCode).toBe(404);
    expect((await call("GET", "/auth/me", b.cookie)).statusCode).toBe(200);
    const listA = (await call("GET", "/auth/sessions", a.cookie)).json() as SessionView[];
    expect(listA.map((s) => s.id)).not.toContain(sessionB!.id);
  });

  it("cierra todas las demás, también en otras organizaciones, y lo audita", async () => {
    const a = await register();
    const other = await register();
    // La cuenta A también es miembro de otra organización, con una sesión allí.
    await ctx.db.insert(schema.memberships).values({ userId: a.userId, organizationId: other.orgId, role: "AUDITOR" });
    const phone = await login(a.email, IPHONE);
    const switched = await app.inject({
      method: "POST",
      url: "/auth/switch-organization",
      payload: { organizationId: other.orgId },
      headers: { cookie: phone },
    });
    const phoneInOther = cookieOf(switched);

    const res = await call("POST", "/auth/sessions/revoke-others", a.cookie);
    expect(res.json()).toEqual({ closed: 1 });
    expect((await call("GET", "/auth/me", phoneInOther)).statusCode).toBe(401);
    expect((await call("GET", "/auth/sessions", a.cookie)).json()).toHaveLength(1);
    const log = (await call("GET", "/audit-log", a.cookie)).json() as { action: string }[];
    expect(log.map((l) => l.action)).toContain("auth.other_sessions_closed");
  });

  it("registra la actividad como mucho cada 5 minutos", async () => {
    const a = await register();
    const [s] = (await call("GET", "/auth/sessions", a.cookie)).json() as (SessionView & { lastSeenAt: string })[];
    const old = new Date(Date.now() - 60 * 60_000);
    await ctx.db.update(schema.sessions).set({ lastSeenAt: old }).where(eq(schema.sessions.id, s!.id));
    await call("GET", "/assessments", a.cookie);
    const [after] = await ctx.db.select().from(schema.sessions).where(eq(schema.sessions.id, s!.id));
    expect(after!.lastSeenAt.getTime()).toBeGreaterThan(old.getTime() + 50 * 60_000);

    // Recién actualizada: otra petición no vuelve a escribir.
    const recent = after!.lastSeenAt;
    await call("GET", "/assessments", a.cookie);
    const [again] = await ctx.db.select().from(schema.sessions).where(eq(schema.sessions.id, s!.id));
    expect(again!.lastSeenAt.getTime()).toBe(recent.getTime());
  });

  it("sin sesión responde 401", async () => {
    expect((await call("GET", "/auth/sessions")).statusCode).toBe(401);
    expect((await call("POST", "/auth/sessions/revoke-others")).statusCode).toBe(401);
  });
});

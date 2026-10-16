import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createSession, schema, type Role } from "@cumplia/db";
import { createTestDb } from "@cumplia/db/testing";
import { buildApp } from "../app.js";
import { MemoryMailer } from "../email/mailer.js";
import { can } from "../security/permissions.js";
import { SESSION_COOKIE, hashToken, newSessionToken, sessionExpiry } from "../security/session.js";
import { base32Decode, totp } from "../security/totp.js";
import { createSessionTenantResolver } from "../tenant.js";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof buildApp>;

const PASSWORD = "clave-segura-de-prueba";

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
const uniqueEmail = () => `rol${++n}@ejemplo.com`;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const call = (method: Method, url: string, cookie?: string, payload?: object) =>
  app.inject({ method, url, payload, headers: cookie ? { cookie } : {} });

/** Registra un ADMIN con su organización. */
const registerAdmin = async () => {
  const email = uniqueEmail();
  const res = await call("POST", "/auth/register", undefined, { email, password: PASSWORD, organizationName: "Empresa" });
  const c = res.cookies.find((x) => x.name === SESSION_COOKIE)!;
  const body = res.json() as { user: { id: string }; organization: { id: string } };
  return { email, userId: body.user.id, orgId: body.organization.id, cookie: `${SESSION_COOKIE}=${c.value}` };
};

/**
 * Suma un usuario a la organización con el rol dado y le abre una sesión en ella.
 * (Mientras no existan invitaciones, la membresía se crea directo en la base.)
 */
const addMember = async (orgId: string, role: Role) => {
  const other = await registerAdmin();
  await ctx.db.insert(schema.memberships).values({ userId: other.userId, organizationId: orgId, role });
  const token = newSessionToken();
  await createSession(ctx.db, { userId: other.userId, organizationId: orgId, tokenHash: hashToken(token), expiresAt: sessionExpiry() });
  return { ...other, cookie: `${SESSION_COOKIE}=${token}` };
};

const enableMfa = async (cookie: string) => {
  const { secret } = (await call("POST", "/auth/mfa/setup", cookie)).json() as { secret: string };
  expect((await call("POST", "/auth/mfa/enable", cookie, { code: totp(base32Decode(secret)) })).statusCode).toBe(200);
};

describe("matriz de permisos", () => {
  it("ADMIN puede todo; CONSULTANT no administra; AUDITOR solo lee", () => {
    expect(can("ADMIN", "members:manage")).toBe(true);
    expect(can("CONSULTANT", "assessment:write")).toBe(true);
    expect(can("CONSULTANT", "audit:read")).toBe(false);
    expect(can("CONSULTANT", "members:read")).toBe(false);
    expect(can("AUDITOR", "assessment:write")).toBe(false);
    expect(can("AUDITOR", "audit:read")).toBe(true);
    expect(can("AUDITOR", "org:manage")).toBe(false);
  });
});

describe("roles aplicados en las rutas", () => {
  it("AUDITOR lee evaluaciones, auditoría y miembros, pero no modifica nada", async () => {
    const admin = await registerAdmin();
    const asm = (await call("POST", "/assessments", admin.cookie, { frameworkId: "iso27001-2022" })).json().id as string;
    const auditor = await addMember(admin.orgId, "AUDITOR");

    for (const url of ["/assessments", `/assessments/${asm}`, `/assessments/${asm}/answers`, `/assessments/${asm}/result`, `/assessments/${asm}/soa`, "/audit-log", "/members", "/organization"]) {
      expect((await call("GET", url, auditor.cookie)).statusCode, url).toBe(200);
    }
    const writes: [Method, string, object][] = [
      ["POST", "/assessments", { frameworkId: "iso27001-2022" }],
      ["PUT", `/assessments/${asm}/answers`, { answers: [{ controlId: "A.5.1", applicable: true, maturity: 2 }] }],
      ["POST", `/assessments/${asm}/evidence`, { controlId: "A.5.1", source: "manual", description: "x" }],
      ["PATCH", "/organization", { name: "Otro nombre" }],
      ["PATCH", `/members/${admin.userId}`, { role: "AUDITOR" }],
    ];
    for (const [method, url, payload] of writes) {
      const res = await call(method, url, auditor.cookie, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json().code).toBe("FORBIDDEN");
    }
    expect((await call("DELETE", `/members/${admin.userId}`, auditor.cookie)).statusCode).toBe(403);
  });

  it("CONSULTANT trabaja las evaluaciones pero no ve auditoría ni administra", async () => {
    const admin = await registerAdmin();
    const consultant = await addMember(admin.orgId, "CONSULTANT");
    const created = await call("POST", "/assessments", consultant.cookie, { frameworkId: "iso27001-2022" });
    expect(created.statusCode).toBe(201);
    const asm = created.json().id as string;
    const saved = await call("PUT", `/assessments/${asm}/answers`, consultant.cookie, {
      answers: [{ controlId: "A.5.1", applicable: true, maturity: 3 }],
    });
    expect(saved.statusCode).toBe(200);
    expect((await call("GET", "/organization", consultant.cookie)).statusCode).toBe(200);
    for (const url of ["/audit-log", "/members"]) {
      expect((await call("GET", url, consultant.cookie)).statusCode, url).toBe(403);
    }
    expect((await call("PATCH", "/organization", consultant.cookie, { name: "Nuevo" })).statusCode).toBe(403);
  });

  it("un cambio de rol rige al instante sobre la sesión abierta", async () => {
    const admin = await registerAdmin();
    const member = await addMember(admin.orgId, "CONSULTANT");
    expect((await call("POST", "/assessments", member.cookie, { frameworkId: "iso27001-2022" })).statusCode).toBe(201);

    const changed = await call("PATCH", `/members/${member.userId}`, admin.cookie, { role: "AUDITOR" });
    expect(changed.json()).toEqual({ userId: member.userId, role: "AUDITOR" });
    const log = (await call("GET", "/audit-log", admin.cookie)).json() as { action: string; details: unknown }[];
    expect(log.find((l) => l.action === "member.role_change")?.details).toEqual({ from: "CONSULTANT", to: "AUDITOR" });
    expect((await call("POST", "/assessments", member.cookie, { frameworkId: "iso27001-2022" })).statusCode).toBe(403);
    expect((await call("GET", "/auth/me", member.cookie)).json().role).toBe("AUDITOR");
  });
});

describe("miembros", () => {
  it("lista los miembros con su rol y si tienen MFA, sin datos sensibles", async () => {
    const admin = await registerAdmin();
    const auditor = await addMember(admin.orgId, "AUDITOR");
    const res = await call("GET", "/members", admin.cookie);
    const members = res.json() as { email: string; role: string; mfaEnabled: boolean }[];
    expect(members).toHaveLength(2);
    expect(members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: admin.email, role: "ADMIN", mfaEnabled: false }),
        expect.objectContaining({ email: auditor.email, role: "AUDITOR" }),
      ]),
    );
    expect(res.body).not.toContain("scrypt$");
    expect(res.body).not.toContain("mfaSecret");
  });

  it("quitar a un miembro cierra su sesión en la organización", async () => {
    const admin = await registerAdmin();
    const member = await addMember(admin.orgId, "CONSULTANT");
    expect((await call("DELETE", `/members/${member.userId}`, admin.cookie)).statusCode).toBe(204);
    expect((await call("GET", "/assessments", member.cookie)).statusCode).toBe(401);
    const log = (await call("GET", "/audit-log", admin.cookie)).json() as { action: string }[];
    expect(log.map((l) => l.action)).toContain("member.remove");
  });

  it("nunca deja a la organización sin ADMIN", async () => {
    const admin = await registerAdmin();
    const demote = await call("PATCH", `/members/${admin.userId}`, admin.cookie, { role: "CONSULTANT" });
    expect(demote.statusCode).toBe(409);
    expect((await call("DELETE", `/members/${admin.userId}`, admin.cookie)).statusCode).toBe(409);

    const second = await addMember(admin.orgId, "ADMIN");
    expect((await call("PATCH", `/members/${admin.userId}`, second.cookie, { role: "CONSULTANT" })).statusCode).toBe(200);
    expect((await call("PATCH", `/members/${second.userId}`, second.cookie, { role: "AUDITOR" })).statusCode).toBe(409);
  });

  it("no se puede tocar a usuarios de otra organización", async () => {
    const a = await registerAdmin();
    const b = await registerAdmin();
    expect((await call("PATCH", `/members/${b.userId}`, a.cookie, { role: "AUDITOR" })).statusCode).toBe(404);
    expect((await call("DELETE", `/members/${b.userId}`, a.cookie)).statusCode).toBe(404);
    expect((await call("GET", "/auth/me", b.cookie)).json().role).toBe("ADMIN");
  });

  it("valida el rol y el id", async () => {
    const admin = await registerAdmin();
    const member = await addMember(admin.orgId, "CONSULTANT");
    expect((await call("PATCH", `/members/${member.userId}`, admin.cookie, { role: "ROOT" })).statusCode).toBe(400);
    expect((await call("PATCH", "/members/no-es-uuid", admin.cookie, { role: "AUDITOR" })).statusCode).toBe(400);
  });
});

describe("MFA obligatorio por organización", () => {
  it("el ADMIN tiene que tener MFA para poder exigirlo", async () => {
    const admin = await registerAdmin();
    expect((await call("PATCH", "/organization", admin.cookie, { requireMfa: true })).statusCode).toBe(409);
    await enableMfa(admin.cookie);
    const res = await call("PATCH", "/organization", admin.cookie, { requireMfa: true });
    expect(res.statusCode).toBe(200);
    expect(res.json().requireMfa).toBe(true);
    const log = (await call("GET", "/audit-log", admin.cookie)).json() as { action: string }[];
    expect(log.map((l) => l.action)).toContain("organization.update");
  });

  it("quien no tiene MFA solo puede configurarlo; después opera normalmente", async () => {
    const admin = await registerAdmin();
    const member = await addMember(admin.orgId, "CONSULTANT");
    await enableMfa(admin.cookie);
    await call("PATCH", "/organization", admin.cookie, { requireMfa: true });

    const blocked = await call("GET", "/assessments", member.cookie);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe("MFA_SETUP_REQUIRED");
    const me = (await call("GET", "/auth/me", member.cookie)).json();
    expect(me.mfaSetupRequired).toBe(true);

    await enableMfa(member.cookie);
    expect((await call("GET", "/assessments", member.cookie)).statusCode).toBe(200);
    expect((await call("GET", "/auth/me", member.cookie)).json().mfaSetupRequired).toBe(false);
  });

  it("con la política activa no se puede desactivar MFA", async () => {
    const admin = await registerAdmin();
    await enableMfa(admin.cookie);
    await call("PATCH", "/organization", admin.cookie, { requireMfa: true });
    const res = await call("POST", "/auth/mfa/disable", admin.cookie, { password: PASSWORD, code: "123456" });
    expect(res.statusCode).toBe(409);
    const [user] = await ctx.db.select().from(schema.users).where(eq(schema.users.email, admin.email));
    expect(user?.mfaEnabledAt).toBeTruthy();
  });
});

describe("rutas protegidas", () => {
  it("una ruta sin permiso declarado impide que la app arranque", async () => {
    const { protectedRoutes } = await import("../protected.js");
    const Fastify = (await import("fastify")).default;
    const bad = Fastify();
    bad.register(async (scope) => {
      await protectedRoutes(scope, { db: ctx.db, resolveTenant: () => null, mailer: new MemoryMailer(), appUrl: "http://x" });
      scope.get("/sin-permiso", async () => "ups");
    });
    await expect(bad.ready()).rejects.toThrow(/sin permiso declarado/);
    await bad.close().catch(() => {});
  });
});

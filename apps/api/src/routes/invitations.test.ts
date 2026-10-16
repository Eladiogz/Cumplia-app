import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, type Role } from "@cumplia/db";
import { createTestDb } from "@cumplia/db/testing";
import { buildApp } from "../app.js";
import { SESSION_COOKIE, hashToken } from "../security/session.js";
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
const uniqueEmail = () => `inv${++n}@ejemplo.com`;

type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Res = Awaited<ReturnType<typeof app.inject>>;
const call = (method: Method, url: string, cookie?: string, payload?: object) =>
  app.inject({ method, url, payload, headers: cookie ? { cookie } : {} });

const cookieOf = (res: Res) => {
  const c = res.cookies.find((x) => x.name === SESSION_COOKIE && x.value !== "");
  return c ? `${SESSION_COOKIE}=${c.value}` : undefined;
};

const registerAdmin = async (organizationName = "Empresa") => {
  const email = uniqueEmail();
  const res = await call("POST", "/auth/register", undefined, { email, password: PASSWORD, organizationName });
  const body = res.json() as { user: { id: string }; organization: { id: string } };
  return { email, userId: body.user.id, orgId: body.organization.id, cookie: cookieOf(res)! };
};

const invite = async (adminCookie: string, email: string, role: Role = "CONSULTANT") => {
  const res = await call("POST", "/invitations", adminCookie, { email, role });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; token: string; email: string; role: Role };
};

const pendingIds = async (adminCookie: string) =>
  ((await call("GET", "/invitations", adminCookie)).json() as { id: string }[]).map((i) => i.id);

describe("gestión de invitaciones", () => {
  it("el ADMIN invita; el token se muestra una vez y en la base queda solo su hash", async () => {
    const admin = await registerAdmin();
    const inv = await invite(admin.cookie, "Nueva.Persona@Ejemplo.com", "AUDITOR");
    expect(inv.email).toBe("nueva.persona@ejemplo.com");
    expect(inv.token.length).toBeGreaterThanOrEqual(43);

    const list = await call("GET", "/invitations", admin.cookie);
    expect(list.json()).toEqual([expect.objectContaining({ id: inv.id, role: "AUDITOR" })]);
    expect(list.body).not.toContain(inv.token);
    expect(list.body).not.toContain("tokenHash");

    const [row] = await ctx.asOwner(() => ctx.db.select().from(schema.invitations).where(eq(schema.invitations.id, inv.id)));
    expect(row?.tokenHash).toBe(hashToken(inv.token));
    const log = (await call("GET", "/audit-log", admin.cookie)).json() as { action: string }[];
    expect(log.map((l) => l.action)).toContain("invitation.create");
  });

  it("solo ADMIN invita o revoca; AUDITOR puede ver las pendientes", async () => {
    const admin = await registerAdmin();
    const consultant = await joinVia(admin.cookie, "CONSULTANT");
    const auditor = await joinVia(admin.cookie, "AUDITOR");
    const inv = await invite(admin.cookie, uniqueEmail());
    expect((await call("POST", "/invitations", consultant.cookie, { email: uniqueEmail(), role: "ADMIN" })).statusCode).toBe(403);
    expect((await call("DELETE", `/invitations/${inv.id}`, auditor.cookie)).statusCode).toBe(403);
    expect((await call("GET", "/invitations", auditor.cookie)).statusCode).toBe(200);
    expect((await call("GET", "/invitations", consultant.cookie)).statusCode).toBe(403);
  });

  it("no invita a quien ya es miembro", async () => {
    const admin = await registerAdmin();
    expect((await call("POST", "/invitations", admin.cookie, { email: admin.email, role: "AUDITOR" })).statusCode).toBe(409);
  });

  it("reinvitar al mismo email invalida el link anterior", async () => {
    const admin = await registerAdmin();
    const email = uniqueEmail();
    const first = await invite(admin.cookie, email);
    const second = await invite(admin.cookie, email, "AUDITOR");
    expect((await call("POST", "/auth/invitations/preview", undefined, { token: first.token })).statusCode).toBe(404);
    expect((await call("POST", "/auth/invitations/preview", undefined, { token: second.token })).statusCode).toBe(200);
    expect(await pendingIds(admin.cookie)).toEqual([second.id]);
  });

  it("una invitación revocada o vencida no sirve", async () => {
    const admin = await registerAdmin();
    const revoked = await invite(admin.cookie, uniqueEmail());
    expect((await call("DELETE", `/invitations/${revoked.id}`, admin.cookie)).statusCode).toBe(204);
    expect((await call("DELETE", `/invitations/${revoked.id}`, admin.cookie)).statusCode).toBe(404);
    expect((await call("POST", "/auth/invitations/preview", undefined, { token: revoked.token })).statusCode).toBe(404);

    const expired = await invite(admin.cookie, uniqueEmail());
    await ctx.asOwner(() =>
      ctx.db.update(schema.invitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.invitations.id, expired.id)),
    );
    const accept = await call("POST", "/auth/invitations/accept", undefined, { token: expired.token, password: PASSWORD });
    expect(accept.statusCode).toBe(404);
    expect(await pendingIds(admin.cookie)).toEqual([]);
  });
});

/** Suma una persona nueva a la organización del ADMIN a través de una invitación. */
const joinVia = async (adminCookie: string, role: Role) => {
  const email = uniqueEmail();
  const inv = await invite(adminCookie, email, role);
  const res = await call("POST", "/auth/invitations/accept", undefined, { token: inv.token, password: PASSWORD });
  expect(res.statusCode, res.body).toBe(201);
  return { email, cookie: cookieOf(res)!, userId: (res.json() as { user: { id: string } }).user.id };
};

describe("aceptar una invitación", () => {
  it("la vista previa muestra organización y rol; un token inventado no", async () => {
    const admin = await registerAdmin("Consultora Sur");
    const inv = await invite(admin.cookie, uniqueEmail(), "AUDITOR");
    const preview = await call("POST", "/auth/invitations/preview", undefined, { token: inv.token });
    expect(preview.json()).toMatchObject({ organizationName: "Consultora Sur", role: "AUDITOR", email: inv.email });
    expect((await call("POST", "/auth/invitations/preview", undefined, { token: "x".repeat(43) })).statusCode).toBe(404);
  });

  it("una persona nueva crea su cuenta y entra a la organización con el rol invitado", async () => {
    const admin = await registerAdmin();
    const inv = await invite(admin.cookie, uniqueEmail(), "AUDITOR");
    const res = await call("POST", "/auth/invitations/accept", undefined, { token: inv.token, password: PASSWORD, name: "Ana" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ user: { email: inv.email, name: "Ana" }, organization: { id: admin.orgId }, role: "AUDITOR" });

    const me = (await call("GET", "/auth/me", cookieOf(res))).json();
    expect(me).toMatchObject({ organizationId: admin.orgId, role: "AUDITOR" });
    // Sin organización propia: solo pertenece a la que la invitó.
    expect((await call("GET", "/auth/organizations", cookieOf(res))).json()).toHaveLength(1);

    // El link ya se usó.
    expect((await call("POST", "/auth/invitations/accept", undefined, { token: inv.token, password: PASSWORD })).statusCode).toBe(404);
    expect(await pendingIds(admin.cookie)).toEqual([]);
    const log = (await call("GET", "/audit-log", admin.cookie)).json() as { action: string }[];
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["invitation.accept", "user.register"]));
  });

  it("sin sesión exige contraseña válida", async () => {
    const admin = await registerAdmin();
    const inv = await invite(admin.cookie, uniqueEmail());
    expect((await call("POST", "/auth/invitations/accept", undefined, { token: inv.token })).statusCode).toBe(400);
    expect((await call("POST", "/auth/invitations/accept", undefined, { token: inv.token, password: "corta" })).statusCode).toBe(400);
    expect((await call("POST", "/auth/invitations/accept", undefined, { token: inv.token, password: inv.email })).statusCode).toBe(400);
  });

  it("si el email ya tiene cuenta, hay que iniciar sesión: no se crea otra ni se pisa la clave", async () => {
    const admin = await registerAdmin();
    const other = await registerAdmin("Su propia empresa");
    const inv = await invite(admin.cookie, other.email);
    const res = await call("POST", "/auth/invitations/accept", undefined, { token: inv.token, password: "otra-clave-de-intruso" });
    expect(res.statusCode).toBe(409);
    expect((await call("POST", "/auth/login", undefined, { email: other.email, password: PASSWORD })).statusCode).toBe(200);
    expect(await pendingIds(admin.cookie)).toEqual([inv.id]);
  });

  it("con sesión, la cuenta se une y pasa a la nueva organización (la sesión anterior se cierra)", async () => {
    const admin = await registerAdmin("Cliente");
    const consultant = await registerAdmin("Consultora");
    const inv = await invite(admin.cookie, consultant.email, "CONSULTANT");

    const res = await call("POST", "/auth/invitations/accept", consultant.cookie, { token: inv.token });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ organization: { id: admin.orgId, name: "Cliente" }, role: "CONSULTANT" });
    const newCookie = cookieOf(res)!;
    expect((await call("GET", "/auth/me", newCookie)).json().organizationId).toBe(admin.orgId);
    expect((await call("GET", "/auth/me", consultant.cookie)).statusCode).toBe(401);

    const orgs = (await call("GET", "/auth/organizations", newCookie)).json() as { organizationId: string; active: boolean }[];
    expect(orgs).toHaveLength(2);
    expect(orgs.find((o) => o.active)?.organizationId).toBe(admin.orgId);
  });

  it("una invitación para otro email no sirve con mi cuenta", async () => {
    const admin = await registerAdmin();
    const intruder = await registerAdmin();
    const inv = await invite(admin.cookie, uniqueEmail());
    const res = await call("POST", "/auth/invitations/accept", intruder.cookie, { token: inv.token });
    expect(res.statusCode).toBe(403);
    expect(await pendingIds(admin.cookie)).toEqual([inv.id]);
    expect((await call("GET", "/auth/organizations", intruder.cookie)).json()).toHaveLength(1);
  });

  it("si la organización exige MFA, quien entra por invitación primero debe activarlo", async () => {
    const admin = await registerAdmin();
    const { secret } = (await call("POST", "/auth/mfa/setup", admin.cookie)).json() as { secret: string };
    await call("POST", "/auth/mfa/enable", admin.cookie, { code: totp(base32Decode(secret)) });
    expect((await call("PATCH", "/organization", admin.cookie, { requireMfa: true })).statusCode).toBe(200);

    const member = await joinVia(admin.cookie, "CONSULTANT");
    const res = await call("GET", "/assessments", member.cookie);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("MFA_SETUP_REQUIRED");
  });
});

describe("cambiar de organización activa", () => {
  it("un consultor alterna entre sus clientes; cada sesión ve solo los datos de su organización", async () => {
    const clientA = await registerAdmin("Cliente A");
    const clientB = await registerAdmin("Cliente B");
    const email = uniqueEmail();
    const invA = await invite(clientA.cookie, email);
    const joined = await call("POST", "/auth/invitations/accept", undefined, { token: invA.token, password: PASSWORD });
    let cookie = cookieOf(joined)!;
    const invB = await invite(clientB.cookie, email);
    cookie = cookieOf(await call("POST", "/auth/invitations/accept", cookie, { token: invB.token }))!;

    const asmB = (await call("POST", "/assessments", cookie, { frameworkId: "iso27001-2022" })).json().id as string;

    const switched = await call("POST", "/auth/switch-organization", cookie, { organizationId: clientA.orgId });
    expect(switched.json()).toMatchObject({ organization: { id: clientA.orgId, name: "Cliente A" }, role: "CONSULTANT" });
    const oldCookie = cookie;
    cookie = cookieOf(switched)!;
    expect((await call("GET", "/auth/me", oldCookie)).statusCode).toBe(401);
    expect((await call("GET", `/assessments/${asmB}`, cookie)).statusCode).toBe(404);
    expect((await call("GET", "/assessments", cookie)).json()).toHaveLength(0);

    const log = (await call("GET", "/audit-log", clientA.cookie)).json() as { action: string }[];
    expect(log.map((l) => l.action)).toContain("auth.switch_organization");
  });

  it("al iniciar sesión vuelve a la última organización usada; si ya no es miembro, a la primera", async () => {
    const client = await registerAdmin("Cliente");
    const consultant = await registerAdmin("Consultora propia");
    const inv = await invite(client.cookie, consultant.email);
    let cookie = cookieOf(await call("POST", "/auth/invitations/accept", consultant.cookie, { token: inv.token }))!;

    const login = () => call("POST", "/auth/login", undefined, { email: consultant.email, password: PASSWORD });
    expect((await login()).json().organization.id).toBe(client.orgId);

    cookie = cookieOf(await call("POST", "/auth/switch-organization", cookie, { organizationId: consultant.orgId }))!;
    expect((await login()).json().organization.id).toBe(consultant.orgId);

    await call("POST", "/auth/switch-organization", cookie, { organizationId: client.orgId });
    expect((await call("DELETE", `/members/${consultant.userId}`, client.cookie)).statusCode).toBe(204);
    expect((await login()).json().organization.id).toBe(consultant.orgId);
  });

  it("no se puede pasar a una organización de la que no se es miembro", async () => {
    const me = await registerAdmin();
    const other = await registerAdmin();
    const res = await call("POST", "/auth/switch-organization", me.cookie, { organizationId: other.orgId });
    expect(res.statusCode).toBe(404);
    expect((await call("GET", "/auth/me", me.cookie)).json().organizationId).toBe(me.orgId);
    expect((await call("POST", "/auth/switch-organization", undefined, { organizationId: other.orgId })).statusCode).toBe(401);
  });
});

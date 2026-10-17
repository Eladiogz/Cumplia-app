import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createSession, schema, type Role } from "@cumplia/db";
import { createTestDb } from "@cumplia/db/testing";
import { buildApp } from "../app.js";
import { MemoryMailer } from "../email/mailer.js";
import { MFA_CHALLENGE_COOKIE, SESSION_COOKIE, hashToken, newSessionToken, sessionExpiry } from "../security/session.js";
import { base32Decode, totp } from "../security/totp.js";
import { createSessionTenantResolver } from "../tenant.js";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof buildApp>;
const mailer = new MemoryMailer();

const PASSWORD = "Clave-Segura-de-Prueba-2026";
const NEW_PASSWORD = "Otra-Clave-Muy-Distinta-77";

beforeAll(async () => {
  ctx = await createTestDb();
  app = buildApp({
    db: ctx.db,
    resolveTenant: createSessionTenantResolver(ctx.db),
    authRateLimit: 1000,
    mfaEncryptionKey: randomBytes(32),
    mailer,
    appUrl: "https://app.cumplia.test",
  });
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

let n = 0;
const uniqueEmail = () => `cuenta${++n}@ejemplo.com`;

type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Res = Awaited<ReturnType<typeof app.inject>>;
const call = (method: Method, url: string, cookie?: string, payload?: object) =>
  app.inject({ method, url, payload, headers: cookie ? { cookie } : {} });
const cookieOf = (res: Res, name = SESSION_COOKIE) => {
  const c = res.cookies.find((x) => x.name === name && x.value !== "");
  return c ? `${name}=${c.value}` : undefined;
};
const login = (email: string, password = PASSWORD) => call("POST", "/auth/login", undefined, { email, password });

/** Token del último email con ese asunto que le llegó a la persona. */
const tokenFromEmail = (to: string, subject: string) => {
  const email = mailer.sent.filter((m) => m.to === to && m.subject === subject).at(-1);
  const match = email?.text.match(/#token=(\S+)/);
  if (!match?.[1]) throw new Error(`No llegó «${subject}» a ${to}`);
  return decodeURIComponent(match[1]);
};
const RESET_SUBJECT = "Restablecé tu contraseña de Cumplia";
const VERIFY_SUBJECT = "Confirmá tu email en Cumplia";
const countTo = (to: string, subject: string) => mailer.sent.filter((m) => m.to === to && m.subject === subject).length;

const register = async (organizationName = "Empresa") => {
  const email = uniqueEmail();
  const res = await call("POST", "/auth/register", undefined, { email, password: PASSWORD, organizationName });
  expect(res.statusCode, res.body).toBe(201);
  const body = res.json() as { user: { id: string }; organization: { id: string } };
  return { email, userId: body.user.id, orgId: body.organization.id, cookie: cookieOf(res)! };
};
const verify = async (email: string) =>
  call("POST", "/auth/email/verify", undefined, { token: tokenFromEmail(email, VERIFY_SUBJECT) });

/** Suma una cuenta existente a la organización con un rol y le abre una sesión allí. */
const addMember = async (orgId: string, role: Role) => {
  const other = await register("Su propia empresa");
  await ctx.db.insert(schema.memberships).values({ userId: other.userId, organizationId: orgId, role });
  const token = newSessionToken();
  await createSession(ctx.db, { userId: other.userId, organizationId: orgId, tokenHash: hashToken(token), expiresAt: sessionExpiry() });
  return { ...other, cookieInOrg: `${SESSION_COOKIE}=${token}` };
};

const enableMfa = async (cookie: string, email: string) => {
  const { secret } = (await call("POST", "/auth/mfa/setup", cookie)).json() as { secret: string };
  const key = base32Decode(secret);
  expect((await call("POST", "/auth/mfa/enable", cookie, { code: totp(key) })).statusCode).toBe(200);
  await ctx.db.update(schema.users).set({ mfaLastUsedStep: null }).where(eq(schema.users.email, email));
  return key;
};

describe("política de contraseñas en la API", () => {
  const attempt = (password: string, organizationName = "Estudio Contable") =>
    call("POST", "/auth/register", undefined, { email: uniqueEmail(), password, organizationName });

  it("rechaza contraseñas sin los cuatro tipos de caracteres, con el detalle de las reglas", async () => {
    const res = await attempt("solo-minusculas-y-largas");
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "WEAK_PASSWORD", rules: expect.arrayContaining(["uppercase", "digit"]) });
  });

  it("rechaza contraseñas comunes aunque cumplan la composición", async () => {
    for (const weak of ["P@ssw0rd2024!", "Sunshine2024!!", "Argentina2024!"]) {
      const res = await attempt(weak);
      expect(res.statusCode, weak).toBe(400);
      expect(res.json().rules, weak).toContain("common");
    }
  });

  it("rechaza datos de la persona u organización", async () => {
    const res = await attempt("Contable#Segura-2024", "Estudio Contable");
    expect(res.json().rules).toContain("personal");
  });

  it("también al crear la cuenta desde una invitación", async () => {
    const admin = await register();
    await verify(admin.email);
    const email = uniqueEmail();
    await call("POST", "/invitations", admin.cookie, { email, role: "AUDITOR" });
    const token = decodeURIComponent(mailer.lastTo(email)!.text.match(/#token=(\S+)/)![1]!);
    const res = await call("POST", "/auth/invitations/accept", undefined, { token, password: "Password123!" });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("WEAK_PASSWORD");
  });
});

describe("verificación del email", () => {
  it("el registro envía el link; sin verificar no se puede invitar; verificado sí", async () => {
    const admin = await register();
    expect((await call("GET", "/auth/me", admin.cookie)).json().emailVerified).toBe(false);
    const blocked = await call("POST", "/invitations", admin.cookie, { email: uniqueEmail(), role: "AUDITOR" });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe("EMAIL_NOT_VERIFIED");

    expect((await verify(admin.email)).statusCode).toBe(200);
    expect((await call("GET", "/auth/me", admin.cookie)).json().emailVerified).toBe(true);
    expect((await call("POST", "/invitations", admin.cookie, { email: uniqueEmail(), role: "AUDITOR" })).statusCode).toBe(201);
    // El link ya se usó.
    expect((await verify(admin.email)).statusCode).toBe(400);
  });

  it("reenviar: solo el último link sirve, no inunda la casilla y no aplica si ya está verificado", async () => {
    const user = await register();
    const first = tokenFromEmail(user.email, VERIFY_SUBJECT);
    await ctx.db.update(schema.userTokens).set({ createdAt: new Date(Date.now() - 120_000) }).where(eq(schema.userTokens.userId, user.userId));
    expect((await call("POST", "/auth/email/verification", user.cookie)).statusCode).toBe(202);
    expect((await call("POST", "/auth/email/verification", user.cookie)).statusCode).toBe(202);
    expect(countTo(user.email, VERIFY_SUBJECT)).toBe(2);
    expect((await call("POST", "/auth/email/verify", undefined, { token: first })).statusCode).toBe(400);
    expect((await verify(user.email)).statusCode).toBe(200);
    expect((await call("POST", "/auth/email/verification", user.cookie)).statusCode).toBe(409);
  });

  it("las cuentas creadas por invitación ya vienen verificadas", async () => {
    const admin = await register();
    await verify(admin.email);
    const email = uniqueEmail();
    await call("POST", "/invitations", admin.cookie, { email, role: "CONSULTANT" });
    const token = decodeURIComponent(mailer.lastTo(email)!.text.match(/#token=(\S+)/)![1]!);
    const res = await call("POST", "/auth/invitations/accept", undefined, { token, password: NEW_PASSWORD });
    expect((await call("GET", "/auth/me", cookieOf(res))).json().emailVerified).toBe(true);
  });
});

describe("olvidé mi contraseña", () => {
  const forgot = (email: string) => call("POST", "/auth/password/forgot", undefined, { email });
  const reset = (token: string, newPassword: string) => call("POST", "/auth/password/reset", undefined, { token, newPassword });

  it("responde lo mismo exista o no la cuenta, y solo envía email si existe", async () => {
    const user = await register();
    const before = mailer.sent.length;
    const ghost = await forgot("nadie-aqui@ejemplo.com");
    const real = await forgot(user.email);
    expect(ghost.statusCode).toBe(202);
    expect(real.statusCode).toBe(202);
    expect(ghost.json()).toEqual(real.json());
    expect(mailer.sent.length).toBe(before + 1);
    expect(mailer.lastTo(user.email)?.text).toContain("https://app.cumplia.test/restablecer#token=");
  });

  it("restablece: la clave nueva funciona, la vieja no, se cierran las sesiones y se avisa", async () => {
    const user = await register();
    await forgot(user.email);
    const token = tokenFromEmail(user.email, RESET_SUBJECT);

    // Una clave débil no gasta el link: se puede reintentar.
    expect((await reset(token, "debil")).statusCode).toBe(400);
    expect((await reset(token, NEW_PASSWORD)).statusCode).toBe(200);

    expect((await call("GET", "/auth/me", user.cookie)).statusCode).toBe(401);
    expect((await login(user.email)).statusCode).toBe(401);
    const ok = await login(user.email, NEW_PASSWORD);
    expect(ok.statusCode).toBe(200);
    expect((await reset(token, "Otra-Mas-Distinta-2026!")).statusCode).toBe(400);
    expect(mailer.lastTo(user.email)?.subject).toBe("Tu contraseña cambió");
    const log = (await call("GET", "/audit-log", cookieOf(ok))).json() as { action: string; details: unknown }[];
    expect(log.find((l) => l.action === "auth.password_reset")?.details).toEqual({ requestedBy: "self" });
  });

  it("desbloquea una cuenta bloqueada, pero no saltea el MFA", async () => {
    const user = await register();
    await enableMfa(user.cookie, user.email);
    for (let i = 0; i < 5; i++) await login(user.email, "Incorrecta-Clave-123!");
    await forgot(user.email);
    expect((await reset(tokenFromEmail(user.email, RESET_SUBJECT), NEW_PASSWORD)).statusCode).toBe(200);
    const res = await login(user.email, NEW_PASSWORD);
    expect(res.json()).toEqual({ mfaRequired: true });
    expect(cookieOf(res)).toBeUndefined();
    expect(cookieOf(res, MFA_CHALLENGE_COOKIE)).toBeTruthy();
  });

  it("un link vencido no sirve y los pedidos seguidos no inundan la casilla", async () => {
    const user = await register();
    await forgot(user.email);
    await forgot(user.email);
    expect(countTo(user.email, RESET_SUBJECT)).toBe(1);
    await ctx.db.update(schema.userTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.userTokens.userId, user.userId));
    expect((await reset(tokenFromEmail(user.email, RESET_SUBJECT), NEW_PASSWORD)).statusCode).toBe(400);
  });
});

describe("cambiar la contraseña estando dentro", () => {
  it("exige la actual, aplica la política, mantiene esta sesión y cierra las otras", async () => {
    const user = await register();
    const other = cookieOf(await login(user.email))!;
    const change = (currentPassword: string, newPassword: string) =>
      call("POST", "/auth/password", user.cookie, { currentPassword, newPassword });

    expect((await change("No-Es-La-Actual-1", NEW_PASSWORD)).statusCode).toBe(403);
    expect((await change(PASSWORD, PASSWORD)).statusCode).toBe(400);
    expect((await change(PASSWORD, "Password123!")).statusCode).toBe(400);
    expect((await change(PASSWORD, NEW_PASSWORD)).statusCode).toBe(204);

    expect((await call("GET", "/auth/me", user.cookie)).statusCode).toBe(200);
    expect((await call("GET", "/auth/me", other)).statusCode).toBe(401);
    expect((await login(user.email, NEW_PASSWORD)).statusCode).toBe(200);
    expect(mailer.lastTo(user.email)?.subject).toBe("Tu contraseña cambió");
  });
});

describe("acciones del ADMIN sobre un miembro (seguras para multi-tenant)", () => {
  it("envía un link de restablecimiento (nunca ve ni fija la clave)", async () => {
    const admin = await register("Consultora Norte");
    const member = await addMember(admin.orgId, "CONSULTANT");
    const res = await call("POST", `/members/${member.userId}/password-reset`, admin.cookie, {});
    expect(res.statusCode).toBe(202);
    expect(JSON.stringify(res.json())).not.toContain("token");
    const email = mailer.lastTo(member.email)!;
    expect(email.subject).toBe(RESET_SUBJECT);
    expect(email.text).toContain("Un administrador de Consultora Norte");
    // La clave actual sigue funcionando hasta que la persona elija otra.
    expect((await login(member.email)).statusCode).toBe(200);

    expect((await call("POST", "/auth/password/reset", undefined, { token: tokenFromEmail(member.email, RESET_SUBJECT), newPassword: NEW_PASSWORD })).statusCode).toBe(200);
    const log = (await call("GET", "/audit-log", admin.cookie)).json() as { action: string; details: unknown }[];
    expect(log.map((l) => l.action)).toContain("member.password_reset_sent");
    expect(log.find((l) => l.action === "auth.password_reset")?.details).toEqual({ requestedBy: "admin" });
  });

  it("solo ADMIN, y solo sobre miembros de su organización", async () => {
    const admin = await register();
    const consultant = await addMember(admin.orgId, "CONSULTANT");
    const outsider = await register();
    expect((await call("POST", `/members/${outsider.userId}/password-reset`, admin.cookie, {})).statusCode).toBe(404);
    expect((await call("POST", `/members/${admin.userId}/password-reset`, consultant.cookieInOrg, {})).statusCode).toBe(403);
  });

  it("cierra las sesiones del miembro SOLO en esta organización", async () => {
    const admin = await register();
    const member = await addMember(admin.orgId, "CONSULTANT");
    expect((await call("POST", `/members/${member.userId}/sessions/revoke`, admin.cookie, {})).statusCode).toBe(204);
    expect((await call("GET", "/auth/me", member.cookieInOrg)).statusCode).toBe(401);
    // Su sesión en su propia organización no es asunto de este ADMIN.
    expect((await call("GET", "/auth/me", member.cookie)).statusCode).toBe(200);
  });

  it("restablece el MFA solo si la cuenta es exclusiva de la organización y el ADMIN tiene MFA", async () => {
    const admin = await register();
    // Una cuenta que solo pertenece a esta organización (entra por invitación).
    await verify(admin.email);
    const email = uniqueEmail();
    await call("POST", "/invitations", admin.cookie, { email, role: "CONSULTANT" });
    const token = decodeURIComponent(mailer.lastTo(email)!.text.match(/#token=(\S+)/)![1]!);
    const joined = await call("POST", "/auth/invitations/accept", undefined, { token, password: NEW_PASSWORD });
    const exclusive = { userId: joined.json().user.id as string, cookie: cookieOf(joined)! };
    await enableMfa(exclusive.cookie, email);

    expect((await call("DELETE", `/members/${exclusive.userId}/mfa`, admin.cookie)).statusCode).toBe(409); // admin sin MFA
    await enableMfa(admin.cookie, admin.email);
    expect((await call("DELETE", `/members/${admin.userId}/mfa`, admin.cookie)).statusCode).toBe(409); // el propio
    expect((await call("DELETE", `/members/${exclusive.userId}/mfa`, admin.cookie)).statusCode).toBe(204);

    expect((await call("GET", "/auth/me", exclusive.cookie)).statusCode).toBe(401);
    const relogin = await login(email, NEW_PASSWORD);
    expect(cookieOf(relogin)).toBeTruthy(); // ya no pide MFA
    expect(mailer.lastTo(email)?.subject).toBe("Un administrador restableció tu verificación en dos pasos");

    // Una cuenta que también está en otra organización: no.
    const shared = await addMember(admin.orgId, "CONSULTANT");
    await enableMfa(shared.cookie, shared.email);
    const res = await call("DELETE", `/members/${shared.userId}/mfa`, admin.cookie);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("otras organizaciones");
  });
});

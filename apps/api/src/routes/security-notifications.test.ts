import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@cumplia/db";
import { createTestDb } from "@cumplia/db/testing";
import { buildApp } from "../app.js";
import { MemoryMailer } from "../email/mailer.js";
import { MFA_CHALLENGE_COOKIE, SESSION_COOKIE } from "../security/session.js";
import { base32Decode, totp } from "../security/totp.js";
import { createSessionTenantResolver } from "../tenant.js";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof buildApp>;
const mailer = new MemoryMailer();

const PASSWORD = "Clave-Segura-de-Prueba-2026";

beforeAll(async () => {
  ctx = await createTestDb();
  app = buildApp({
    db: ctx.db,
    resolveTenant: createSessionTenantResolver(ctx.db),
    authRateLimit: 1000,
    mfaEncryptionKey: randomBytes(32),
    mailer,
  });
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

let n = 0;
const uniqueEmail = () => `aviso${++n}@ejemplo.com`;

type Res = Awaited<ReturnType<typeof app.inject>>;
const call = (method: "GET" | "POST" | "PATCH", url: string, cookie?: string, payload?: object) =>
  app.inject({ method, url, payload, headers: cookie ? { cookie } : {} });
const cookieOf = (res: Res, name = SESSION_COOKIE) => {
  const c = res.cookies.find((x) => x.name === name && x.value !== "");
  return c ? `${name}=${c.value}` : undefined;
};
const subjectsTo = (to: string) => mailer.sent.filter((m) => m.to === to).map((m) => m.subject);

const register = async (organizationName = "Empresa") => {
  const email = uniqueEmail();
  const res = await call("POST", "/auth/register", undefined, { email, password: PASSWORD, organizationName });
  // Invitar exige email verificado (el flujo de verificación se prueba en account-security.test.ts).
  await ctx.db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.email, email));
  return { email, cookie: cookieOf(res)!, orgId: (res.json() as { organization: { id: string } }).organization.id };
};

/** Activa MFA y deja el último paso libre (para poder usar el código actual otra vez). */
const withMfa = async () => {
  const user = await register();
  const { secret } = (await call("POST", "/auth/mfa/setup", user.cookie)).json() as { secret: string };
  const key = base32Decode(secret);
  const enabled = await call("POST", "/auth/mfa/enable", user.cookie, { code: totp(key) });
  const forgetStep = () => ctx.db.update(schema.users).set({ mfaLastUsedStep: null }).where(eq(schema.users.email, user.email));
  await forgetStep();
  return { ...user, key, forgetStep, recoveryCodes: enabled.json().recoveryCodes as string[] };
};

describe("avisos de seguridad por email", () => {
  it("avisa al activar y al desactivar MFA", async () => {
    const user = await withMfa();
    expect(subjectsTo(user.email)).toContain("Activaste la verificación en dos pasos");
    const res = await call("POST", "/auth/mfa/disable", user.cookie, { password: PASSWORD, code: totp(user.key) });
    expect(res.statusCode).toBe(204);
    expect(subjectsTo(user.email)).toContain("Se desactivó la verificación en dos pasos");
  });

  it("avisa cuando se entra con un código de recuperación, con cuántos quedan", async () => {
    const user = await withMfa();
    const login = await call("POST", "/auth/login", undefined, { email: user.email, password: PASSWORD });
    const res = await call("POST", "/auth/mfa/verify", cookieOf(login, MFA_CHALLENGE_COOKIE), { recoveryCode: user.recoveryCodes[0] });
    expect(res.statusCode).toBe(200);
    expect(mailer.lastTo(user.email)?.subject).toBe("Se usó un código de recuperación");
    expect(mailer.lastTo(user.email)?.text).toContain("Te quedan 9");
  });

  it("avisa UNA vez cuando la cuenta se bloquea por intentos fallidos", async () => {
    const user = await register();
    for (let i = 0; i < 7; i++) await call("POST", "/auth/login", undefined, { email: user.email, password: "incorrecta-123456" });
    expect(subjectsTo(user.email).filter((s) => s === "Bloqueamos tu cuenta temporalmente")).toHaveLength(1);
  });

  it("un email inexistente no genera avisos (no revela nada)", async () => {
    const before = mailer.sent.length;
    for (let i = 0; i < 6; i++) await call("POST", "/auth/login", undefined, { email: "nadie@ejemplo.com", password: "x" });
    expect(mailer.sent.length).toBe(before);
  });
});

describe("códigos de recuperación", () => {
  it("se regeneran con un código de la app; los anteriores dejan de servir", async () => {
    const user = await withMfa();
    expect((await call("POST", "/auth/mfa/recovery-codes", user.cookie, { code: "000000" })).statusCode).toBe(403);
    const res = await call("POST", "/auth/mfa/recovery-codes", user.cookie, { code: totp(user.key) });
    expect(res.statusCode).toBe(200);
    const fresh = res.json().recoveryCodes as string[];
    expect(fresh).toHaveLength(10);
    expect(fresh).not.toContain(user.recoveryCodes[0]);

    const tryCode = async (recoveryCode: string) => {
      const login = await call("POST", "/auth/login", undefined, { email: user.email, password: PASSWORD });
      return (await call("POST", "/auth/mfa/verify", cookieOf(login, MFA_CHALLENGE_COOKIE), { recoveryCode })).statusCode;
    };
    expect(await tryCode(user.recoveryCodes[0]!)).toBe(401);
    expect(await tryCode(fresh[0]!)).toBe(200);
  });
});

describe("MFA exigido por otra organización del usuario", () => {
  it("no se puede desactivar aunque la organización activa no lo exija", async () => {
    const consultant = await withMfa();
    const client = await register("Cliente exigente");
    // El cliente exige MFA (su ADMIN lo activa primero) e invita al consultor.
    const { secret } = (await call("POST", "/auth/mfa/setup", client.cookie)).json() as { secret: string };
    await call("POST", "/auth/mfa/enable", client.cookie, { code: totp(base32Decode(secret)) });
    expect((await call("PATCH", "/organization", client.cookie, { requireMfa: true })).statusCode).toBe(200);
    await call("POST", "/invitations", client.cookie, { email: consultant.email, role: "CONSULTANT" });
    const token = decodeURIComponent(mailer.lastTo(consultant.email)!.text.match(/#token=(\S+)/)![1]!);
    const accepted = await call("POST", "/auth/invitations/accept", consultant.cookie, { token });
    // Vuelve a su propia organización (que no exige MFA) e intenta desactivarlo.
    const own = await call("POST", "/auth/switch-organization", cookieOf(accepted), { organizationId: consultant.orgId });
    const res = await call("POST", "/auth/mfa/disable", cookieOf(own), { password: PASSWORD, code: totp(consultant.key) });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("Cliente exigente");
  });
});

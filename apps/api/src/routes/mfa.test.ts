import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@cumplia/db";
import { createTestDb } from "@cumplia/db/testing";
import { buildApp } from "../app.js";
import { MFA_CHALLENGE_COOKIE, SESSION_COOKIE } from "../security/session.js";
import { base32Decode, totp } from "../security/totp.js";
import { createSessionTenantResolver } from "../tenant.js";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof buildApp>;

const PASSWORD = "Clave-Segura-de-Prueba-2026";
const KEY = randomBytes(32);

beforeAll(async () => {
  ctx = await createTestDb();
  app = buildApp({
    db: ctx.db,
    resolveTenant: createSessionTenantResolver(ctx.db),
    authRateLimit: 1000,
    mfaEncryptionKey: KEY,
  });
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

let n = 0;
const uniqueEmail = () => `mfa${++n}@ejemplo.com`;

const post = (url: string, payload?: object, cookie?: string) =>
  app.inject({ method: "POST", url, payload, headers: cookie ? { cookie } : {} });
const get = (url: string, cookie?: string) => app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });

type Res = Awaited<ReturnType<typeof post>>;
const cookieOf = (res: Res, name = SESSION_COOKIE) => {
  const c = res.cookies.find((x) => x.name === name && x.value !== "");
  return c ? `${name}=${c.value}` : undefined;
};

const userRow = async (email: string) => {
  const [u] = await ctx.db.select().from(schema.users).where(eq(schema.users.email, email));
  return u!;
};

/** Permite usar el código del paso actual otra vez (en la vida real, esperar 30 s). */
const forgetLastStep = (email: string) =>
  ctx.db.update(schema.users).set({ mfaLastUsedStep: null }).where(eq(schema.users.email, email));

const register = async () => {
  const email = uniqueEmail();
  const res = await post("/auth/register", { email, password: PASSWORD, organizationName: "Empresa" });
  return { email, cookie: cookieOf(res)! };
};

/** Usuario con MFA activo: devuelve el secreto (como lo tendría su app) y los códigos de recuperación. */
const registerWithMfa = async () => {
  const { email, cookie } = await register();
  const setup = (await post("/auth/mfa/setup", undefined, cookie)).json() as { secret: string };
  const secret = base32Decode(setup.secret);
  const enabled = await post("/auth/mfa/enable", { code: totp(secret) }, cookie);
  expect(enabled.statusCode).toBe(200);
  await forgetLastStep(email);
  return { email, cookie, secret, recoveryCodes: enabled.json().recoveryCodes as string[] };
};

/** Primer paso del login: devuelve la cookie del desafío. */
const loginStep1 = async (email: string) => {
  const res = await post("/auth/login", { email, password: PASSWORD });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ mfaRequired: true });
  return cookieOf(res, MFA_CHALLENGE_COOKIE)!;
};

describe("activación de MFA", () => {
  it("exige sesión", async () => {
    expect((await post("/auth/mfa/setup")).statusCode).toBe(401);
    expect((await post("/auth/mfa/enable", { code: "123456" })).statusCode).toBe(401);
    expect((await post("/auth/mfa/disable", { password: PASSWORD, code: "123456" })).statusCode).toBe(401);
  });

  it("no se puede activar sin configurar antes", async () => {
    const { cookie } = await register();
    expect((await post("/auth/mfa/enable", { code: "123456" }, cookie)).statusCode).toBe(409);
  });

  it("configura, confirma con un código y entrega 10 códigos de recuperación", async () => {
    const { email, cookie } = await register();
    const setup = await post("/auth/mfa/setup", undefined, cookie);
    expect(setup.statusCode).toBe(200);
    const { secret, otpauthUri } = setup.json() as { secret: string; otpauthUri: string };
    expect(otpauthUri).toContain(`secret=${secret}`);

    expect((await post("/auth/mfa/enable", { code: "000000" }, cookie)).statusCode).toBe(400);
    expect((await get("/auth/me", cookie)).json().mfaEnabled).toBe(false);

    const enabled = await post("/auth/mfa/enable", { code: totp(base32Decode(secret)) }, cookie);
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().recoveryCodes).toHaveLength(10);
    expect((await get("/auth/me", cookie)).json().mfaEnabled).toBe(true);
    expect((await post("/auth/mfa/setup", undefined, cookie)).statusCode).toBe(409);

    const log = (await get("/audit-log", cookie)).json() as { action: string }[];
    expect(log.map((l) => l.action)).toContain("mfa.enabled");
    expect((await userRow(email)).mfaEnabledAt).toBeTruthy();
  });

  it("guarda el secreto cifrado y los códigos de recuperación solo como hash", async () => {
    const { email, secret, recoveryCodes } = await registerWithMfa();
    const user = await userRow(email);
    expect(user.mfaSecret).toMatch(/^v1\./);
    expect(user.mfaSecret).not.toContain(secret.toString("base64url"));
    const rows = await ctx.db.select().from(schema.mfaRecoveryCodes).where(eq(schema.mfaRecoveryCodes.userId, user.id));
    expect(rows).toHaveLength(10);
    for (const r of rows) expect(recoveryCodes).not.toContain(r.codeHash);
  });

  it("al activar cierra las otras sesiones abiertas, pero no la actual", async () => {
    const { email, cookie } = await register();
    const other = cookieOf(await post("/auth/login", { email, password: PASSWORD }))!;
    const setup = (await post("/auth/mfa/setup", undefined, cookie)).json() as { secret: string };
    await post("/auth/mfa/enable", { code: totp(base32Decode(setup.secret)) }, cookie);
    expect((await get("/auth/me", cookie)).statusCode).toBe(200);
    expect((await get("/auth/me", other)).statusCode).toBe(401);
  });
});

describe("inicio de sesión con MFA", () => {
  it("la contraseña sola no da sesión; el desafío no sirve como sesión", async () => {
    const { email } = await registerWithMfa();
    const res = await post("/auth/login", { email, password: PASSWORD });
    expect(res.json()).toEqual({ mfaRequired: true });
    expect(cookieOf(res)).toBeUndefined();

    const c = res.cookies.find((x) => x.name === MFA_CHALLENGE_COOKIE) as Record<string, unknown>;
    expect(c.httpOnly).toBe(true);
    expect(String(c.sameSite).toLowerCase()).toBe("strict");
    expect(c.path).toBe("/auth/mfa");

    const asSession = `${SESSION_COOKIE}=${String(c.value)}`;
    expect((await get("/auth/me", asSession)).statusCode).toBe(401);
    expect((await get("/assessments", asSession)).statusCode).toBe(401);
  });

  it("con el código correcto crea la sesión", async () => {
    const { email, secret } = await registerWithMfa();
    const challenge = await loginStep1(email);
    const res = await post("/auth/mfa/verify", { code: totp(secret) }, challenge);
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("ADMIN");
    const session = cookieOf(res)!;
    expect((await get("/auth/me", session)).json().user.email).toBe(email);
    expect((await post("/assessments", { frameworkId: "iso27001-2022" }, session)).statusCode).toBe(201);

    // El desafío ya se canjeó: no se puede volver a usar.
    expect((await post("/auth/mfa/verify", { code: totp(secret, Date.now() + 30_000) }, challenge)).statusCode).toBe(401);
    const log = (await get("/audit-log", session)).json() as { action: string }[];
    expect(log.map((l) => l.action)).toContain("auth.login");
  });

  it("no acepta el mismo código dos veces", async () => {
    const { email, secret } = await registerWithMfa();
    const code = totp(secret);
    expect((await post("/auth/mfa/verify", { code }, await loginStep1(email))).statusCode).toBe(200);
    expect((await post("/auth/mfa/verify", { code }, await loginStep1(email))).statusCode).toBe(401);
  });

  it("tras 5 códigos incorrectos bloquea la cuenta, aunque luego llegue el correcto", async () => {
    const { email, secret } = await registerWithMfa();
    const challenge = await loginStep1(email);
    for (let i = 0; i < 5; i++) {
      expect((await post("/auth/mfa/verify", { code: "000000" }, challenge)).statusCode).toBe(401);
    }
    expect((await post("/auth/mfa/verify", { code: totp(secret) }, challenge)).statusCode).toBe(401);
    expect((await userRow(email)).lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect((await post("/auth/login", { email, password: PASSWORD })).statusCode).toBe(401);
  });

  it("un código de recuperación sirve una sola vez", async () => {
    const { email, recoveryCodes } = await registerWithMfa();
    const code = recoveryCodes[0]!;
    const res = await post("/auth/mfa/verify", { recoveryCode: code.toUpperCase() }, await loginStep1(email));
    expect(res.statusCode).toBe(200);
    expect(res.json().recoveryCodesRemaining).toBe(9);
    expect((await post("/auth/mfa/verify", { recoveryCode: code }, await loginStep1(email))).statusCode).toBe(401);
    const log = (await get("/audit-log", cookieOf(res))).json() as { action: string }[];
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["mfa.recovery_code_used", "auth.mfa_failed"]));
  });

  it("un desafío vencido o ausente no sirve", async () => {
    const { email, secret } = await registerWithMfa();
    expect((await post("/auth/mfa/verify", { code: totp(secret) })).statusCode).toBe(401);
    const challenge = await loginStep1(email);
    await ctx.db
      .update(schema.mfaChallenges)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.mfaChallenges.userId, (await userRow(email)).id));
    expect((await post("/auth/mfa/verify", { code: totp(secret) }, challenge)).statusCode).toBe(401);
  });

  it("valida que llegue un solo tipo de código", async () => {
    const { email } = await registerWithMfa();
    const challenge = await loginStep1(email);
    expect((await post("/auth/mfa/verify", {}, challenge)).statusCode).toBe(400);
    expect((await post("/auth/mfa/verify", { code: "123456", recoveryCode: "abcde-fghjk" }, challenge)).statusCode).toBe(400);
    expect((await post("/auth/mfa/verify", { code: "12ab" }, challenge)).statusCode).toBe(400);
  });
});

describe("desactivación de MFA", () => {
  it("exige contraseña y código; luego el login vuelve a ser de un paso", async () => {
    const { email, cookie, secret } = await registerWithMfa();
    expect((await post("/auth/mfa/disable", { password: "otra-clave-cualquiera", code: totp(secret) }, cookie)).statusCode).toBe(403);
    expect((await post("/auth/mfa/disable", { password: PASSWORD, code: "000000" }, cookie)).statusCode).toBe(403);
    await forgetLastStep(email);
    expect((await post("/auth/mfa/disable", { password: PASSWORD, code: totp(secret) }, cookie)).statusCode).toBe(204);

    const user = await userRow(email);
    expect(user.mfaSecret).toBeNull();
    expect(user.mfaEnabledAt).toBeNull();
    const codes = await ctx.db.select().from(schema.mfaRecoveryCodes).where(eq(schema.mfaRecoveryCodes.userId, user.id));
    expect(codes).toHaveLength(0);

    const login = await post("/auth/login", { email, password: PASSWORD });
    expect(cookieOf(login)).toBeTruthy();
    const log = (await get("/audit-log", cookieOf(login))).json() as { action: string }[];
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["mfa.disable_failed", "mfa.disabled"]));
  });
});

describe("detrás del proxy de la web", () => {
  it("la cookie del desafío viaja a la ruta que ve el navegador (/api/auth/mfa)", async () => {
    const { email } = await registerWithMfa();
    const proxied = buildApp({ db: ctx.db, authRateLimit: 1000, mfaEncryptionKey: KEY, publicPathPrefix: "/api" });
    const res = await proxied.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD } });
    const c = res.cookies.find((x) => x.name === MFA_CHALLENGE_COOKIE) as Record<string, unknown>;
    expect(c.path).toBe("/api/auth/mfa");
    await proxied.close();
  });
});

describe("sin clave de cifrado", () => {
  it("no expone las rutas de MFA y quien tiene MFA no puede saltearlo", async () => {
    const { email } = await registerWithMfa();
    const noKey = buildApp({ db: ctx.db, authRateLimit: 1000 });
    const res = await noKey.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD } });
    expect(res.json()).toEqual({ mfaRequired: true });
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
    expect((await noKey.inject({ method: "POST", url: "/auth/mfa/verify", payload: { code: "123456" } })).statusCode).toBe(404);
    await noKey.close();
  });
});

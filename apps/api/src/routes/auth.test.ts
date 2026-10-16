import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@cumplia/db";
import { createTestDb } from "@cumplia/db/testing";
import { buildApp } from "../app.js";
import { SESSION_COOKIE, hashToken } from "../security/session.js";
import { createSessionTenantResolver } from "../tenant.js";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof buildApp>;

const ORIGIN = "http://localhost:3001";
const PASSWORD = "clave-segura-de-prueba";

beforeAll(async () => {
  ctx = await createTestDb();
  app = buildApp({
    db: ctx.db,
    resolveTenant: createSessionTenantResolver(ctx.db),
    allowedOrigins: [ORIGIN],
    authRateLimit: 1000,
  });
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

let n = 0;
const uniqueEmail = () => `user${++n}@ejemplo.com`;

const post = (url: string, payload?: object, cookie?: string, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url, payload, headers: { ...(cookie ? { cookie } : {}), ...headers } });
const get = (url: string, cookie?: string) => app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });

const cookieOf = (res: { cookies: { name: string; value: string }[] }) => {
  const c = res.cookies.find((x) => x.name === SESSION_COOKIE);
  return c ? `${SESSION_COOKIE}=${c.value}` : undefined;
};

const register = async (email = uniqueEmail(), organizationName = "Empresa") => {
  const res = await post("/auth/register", { email, password: PASSWORD, organizationName });
  return { res, email, cookie: cookieOf(res)! };
};

describe("registro", () => {
  it("crea usuario y organización, inicia sesión y devuelve rol ADMIN", async () => {
    const { res, email, cookie } = await register();
    expect(res.statusCode).toBe(201);
    expect(res.json().role).toBe("ADMIN");
    expect(res.json().user.email).toBe(email);
    expect(res.body).not.toContain("passwordHash");
    expect(res.body).not.toContain("scrypt$");
    expect(cookie).toBeTruthy();
  });

  it("la cookie es httpOnly y SameSite=Lax", async () => {
    const { res } = await register();
    const c = res.cookies.find((x) => x.name === SESSION_COOKIE) as Record<string, unknown>;
    expect(c.httpOnly).toBe(true);
    expect(String(c.sameSite).toLowerCase()).toBe("lax");
    expect(c.path).toBe("/");
  });

  it("normaliza el email y rechaza duplicados con un mensaje genérico", async () => {
    const email = uniqueEmail();
    await register(email);
    const dup = await post("/auth/register", { email: email.toUpperCase(), password: PASSWORD, organizationName: "Otra" });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe("No se pudo completar el registro");
  });

  it("aplica la política de contraseñas y valida entradas", async () => {
    const base = { email: uniqueEmail(), organizationName: "X Corp" };
    expect((await post("/auth/register", { ...base, password: "corta" })).statusCode).toBe(400);
    expect((await post("/auth/register", { ...base, password: "a".repeat(200) })).statusCode).toBe(400);
    expect((await post("/auth/register", { ...base, email: "no-es-email", password: PASSWORD })).statusCode).toBe(400);
    const same = "usuario.largo@ejemplo.com";
    expect((await post("/auth/register", { email: same, password: same, organizationName: "X Corp" })).statusCode).toBe(400);
  });

  it("guarda solo el hash de la contraseña y de la sesión", async () => {
    const { email, cookie } = await register();
    const [user] = await ctx.db.select().from(schema.users).where(eq(schema.users.email, email));
    expect(user?.passwordHash?.startsWith("scrypt$")).toBe(true);
    expect(user?.passwordHash).not.toContain(PASSWORD);
    const token = cookie.split("=")[1]!;
    const rows = await ctx.db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toBe(token);
  });
});

describe("sesión", () => {
  it("/auth/me devuelve el usuario con sesión y 401 sin ella", async () => {
    const { cookie, email } = await register();
    const me = await get("/auth/me", cookie);
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(email);
    expect(me.json().role).toBe("ADMIN");
    expect((await get("/auth/me")).statusCode).toBe(401);
    expect((await get("/auth/me", `${SESSION_COOKIE}=token-falso`)).statusCode).toBe(401);
  });

  it("la cookie da acceso a las rutas de evaluaciones y sin ella es 401", async () => {
    const { cookie } = await register();
    expect((await get("/assessments")).statusCode).toBe(401);
    const created = await post("/assessments", { frameworkId: "iso27001-2022" }, cookie);
    expect(created.statusCode).toBe(201);
    expect((await get("/assessments", cookie)).json()).toHaveLength(1);
  });

  it("dos usuarios no ven los datos del otro", async () => {
    const a = await register(uniqueEmail(), "Empresa A");
    const b = await register(uniqueEmail(), "Empresa B");
    const asm = (await post("/assessments", { frameworkId: "iso27001-2022" }, a.cookie)).json();
    expect((await get(`/assessments/${asm.id}`, b.cookie)).statusCode).toBe(404);
    expect((await get("/assessments", b.cookie)).json()).toHaveLength(0);
    expect((await get(`/assessments/${asm.id}`, a.cookie)).statusCode).toBe(200);
  });

  it("el actor de la auditoría es el usuario autenticado", async () => {
    const { cookie } = await register();
    await post("/assessments", { frameworkId: "iso27001-2022" }, cookie);
    const log = (await get("/audit-log", cookie)).json() as { action: string; actorId: string | null }[];
    const created = log.find((l) => l.action === "assessment.create");
    expect(created?.actorId).toBeTruthy();
  });

  it("logout invalida la sesión en el servidor aunque se reutilice la cookie", async () => {
    const { cookie } = await register();
    expect((await post("/auth/logout", undefined, cookie)).statusCode).toBe(204);
    expect((await get("/auth/me", cookie)).statusCode).toBe(401);
    expect((await get("/assessments", cookie)).statusCode).toBe(401);
  });

  it("una sesión vencida deja de valer", async () => {
    const { cookie } = await register();
    const token = cookie.split("=")[1]!;
    await ctx.db
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.sessions.tokenHash, hashToken(token)));
    expect((await get("/auth/me", cookie)).statusCode).toBe(401);
  });

  it("si quitan al usuario de la organización, la sesión deja de valer", async () => {
    const { cookie, email } = await register();
    const [user] = await ctx.db.select().from(schema.users).where(eq(schema.users.email, email));
    await ctx.db.delete(schema.memberships).where(eq(schema.memberships.userId, user!.id));
    expect((await get("/assessments", cookie)).statusCode).toBe(401);
  });
});

describe("inicio de sesión", () => {
  it("acepta la clave correcta (email sin importar mayúsculas)", async () => {
    const { email } = await register();
    const res = await post("/auth/login", { email: email.toUpperCase(), password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(cookieOf(res)).toBeTruthy();
    expect(res.json().role).toBe("ADMIN");
  });

  it("da el mismo error para usuario inexistente y clave incorrecta", async () => {
    const { email } = await register();
    const wrong = await post("/auth/login", { email, password: "clave-equivocada-123" });
    const ghost = await post("/auth/login", { email: "fantasma@ejemplo.com", password: PASSWORD });
    expect(wrong.statusCode).toBe(401);
    expect(ghost.statusCode).toBe(401);
    expect(wrong.json()).toEqual(ghost.json());
    expect(cookieOf(wrong)).toBeUndefined();
  });

  it("bloquea la cuenta tras 5 intentos fallidos, incluso con la clave correcta", async () => {
    const { email } = await register();
    for (let i = 0; i < 5; i++) {
      expect((await post("/auth/login", { email, password: "incorrecta-123456" })).statusCode).toBe(401);
    }
    const locked = await post("/auth/login", { email, password: PASSWORD });
    expect(locked.statusCode).toBe(401);
    expect(cookieOf(locked)).toBeUndefined();
  });

  it("un bloqueo vencido permite entrar y reinicia el contador", async () => {
    const { email } = await register();
    for (let i = 0; i < 5; i++) await post("/auth/login", { email, password: "incorrecta-123456" });
    await ctx.db
      .update(schema.users)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(schema.users.email, email));
    expect((await post("/auth/login", { email, password: PASSWORD })).statusCode).toBe(200);
    const [u] = await ctx.db.select().from(schema.users).where(eq(schema.users.email, email));
    expect(u?.failedLoginAttempts).toBe(0);
  });

  it("deja registro de auditoría de accesos correctos y fallidos", async () => {
    const { email, cookie } = await register();
    await post("/auth/login", { email, password: "incorrecta-123456" });
    const ok = await post("/auth/login", { email, password: PASSWORD });
    const log = (await get("/audit-log", cookieOf(ok))).json() as { action: string; details: unknown }[];
    const actions = log.map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["user.register", "auth.login_failed", "auth.login"]));
    expect(log.find((l) => l.action === "auth.login_failed")?.details).toEqual({ reason: "invalid_credentials" });
    expect(cookie).toBeTruthy();
  });
});

describe("protecciones", () => {
  it("rechaza peticiones que modifican datos desde un origen no autorizado", async () => {
    const { cookie } = await register();
    const bad = await post("/assessments", { frameworkId: "iso27001-2022" }, cookie, { origin: "https://sitio-malicioso.example" });
    expect(bad.statusCode).toBe(403);
    const good = await post("/assessments", { frameworkId: "iso27001-2022" }, cookie, { origin: ORIGIN });
    expect(good.statusCode).toBe(201);
  });

  it("limita los intentos por minuto en login y registro", async () => {
    const limited = buildApp({ db: ctx.db, authRateLimit: 3 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await limited.inject({ method: "POST", url: "/auth/login", payload: { email: "a@b.com", password: "x" } })).statusCode);
    }
    expect(codes.slice(0, 3)).not.toContain(429);
    expect(codes.slice(3)).toEqual([429, 429]);
    await limited.close();
  });
});

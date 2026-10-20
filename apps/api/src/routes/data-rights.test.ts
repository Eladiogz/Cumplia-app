import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { createSession, forOrganization, schema, setTenantContext, type Role } from "@cumplia/db";
import { createTestDb } from "@cumplia/db/testing";
import { buildApp } from "../app.js";
import { MemoryMailer } from "../email/mailer.js";
import { SESSION_COOKIE, hashToken, newSessionToken, sessionExpiry } from "../security/session.js";
import { MemoryStorage } from "../storage/storage.js";
import { base32Decode, totp } from "../security/totp.js";
import { createSessionTenantResolver } from "../tenant.js";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof buildApp>;
const mailer = new MemoryMailer();
const storage = new MemoryStorage();

const PASSWORD = "Clave-Segura-de-Prueba-2026";

beforeAll(async () => {
  ctx = await createTestDb();
  app = buildApp({
    db: ctx.db,
    resolveTenant: createSessionTenantResolver(ctx.db),
    authRateLimit: 1000,
    mfaEncryptionKey: randomBytes(32),
    mailer,
    storage,
  });
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

let n = 0;
const uniqueEmail = () => `datos${++n}@ejemplo.com`;

type Method = "GET" | "POST" | "PATCH";
const call = (method: Method, url: string, cookie?: string, payload?: object) =>
  app.inject({ method, url, payload, headers: cookie ? { cookie } : {} });

/** ADMIN con su organización y el email ya verificado. */
const registerAdmin = async (organizationName = "Empresa") => {
  const email = uniqueEmail();
  const res = await call("POST", "/auth/register", undefined, { email, password: PASSWORD, organizationName });
  const c = res.cookies.find((x) => x.name === SESSION_COOKIE)!;
  const body = res.json() as { user: { id: string }; organization: { id: string } };
  await ctx.db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, body.user.id));
  return { email, userId: body.user.id, orgId: body.organization.id, organizationName, cookie: `${SESSION_COOKIE}=${c.value}` };
};

/** Suma a la persona a otra organización con ese rol y le abre una sesión ahí. */
const joinAs = async (user: { userId: string }, orgId: string, role: Role) => {
  await ctx.db.insert(schema.memberships).values({ userId: user.userId, organizationId: orgId, role });
  const token = newSessionToken();
  await createSession(ctx.db, { userId: user.userId, organizationId: orgId, tokenHash: hashToken(token), expiresAt: sessionExpiry() });
  return `${SESSION_COOKIE}=${token}`;
};

const auditActions = async (orgId: string) =>
  (await forOrganization(ctx.db, orgId).listAuditLog(200)).map((l) => l.action);

const userExists = async (userId: string) =>
  (await ctx.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId))).length > 0;

/** Cuenta filas de la organización como dueño (sin RLS): lo que de verdad quedó en la base. */
const rowsOf = (orgId: string) =>
  ctx.asOwner(async () => {
    const count = async (table: string) => {
      const res = (await ctx.db.execute(sql.raw(`select count(*)::int as n from ${table} where organization_id = '${orgId}'`))) as unknown as {
        rows: { n: number }[];
      };
      return res.rows[0]!.n;
    };
    const tables = ["assessments", "control_answers", "evidence", "risks", "invitations", "memberships", "sessions", "audit_logs"];
    return Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await count(t)] as const)));
  });

/** Evaluación con una respuesta, evidencia con archivo, un riesgo y una invitación. */
const seed = async (orgId: string, actorId: string) => {
  const repo = forOrganization(ctx.db, orgId, actorId);
  const assessment = await repo.createAssessment("iso27001-2022", 3, "Gap anual");
  await repo.saveAnswers(assessment.id, [{ controlId: "A.5.1", applicable: true, maturity: 2, justification: "Política aprobada" }]);
  const fileId = randomUUID();
  const key = `org/${orgId}/assessments/${assessment.id}/evidence/${fileId}`;
  const pdf = Buffer.from(`%PDF-1.7 evidencia de ${orgId}`);
  await storage.put(key, pdf, "application/pdf");
  await repo.addEvidence(assessment.id, "A.5.1", "archivo", "Política firmada", {
    id: fileId,
    key,
    name: "politica.pdf",
    size: pdf.length,
    contentType: "application/pdf",
    sha256: "a".repeat(64),
  });
  const risk = await repo.createRisk({ title: "Fuga de datos", likelihood: 3, impact: 4 });
  await repo.createInvitation({ email: uniqueEmail(), role: "AUDITOR", tokenHash: `hash-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) });
  return { assessmentId: assessment.id, fileId, key, pdf, riskId: risk.id };
};

describe("datos propios", () => {
  it("cambiar el nombre propio, sin links, queda auditado", async () => {
    const admin = await registerAdmin();
    const res = await call("PATCH", "/auth/me", admin.cookie, { name: "  Ana Pérez " });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ user: { name: "Ana Pérez", email: admin.email } });
    expect((await call("GET", "/auth/me", admin.cookie)).json().user.name).toBe("Ana Pérez");
    expect(await auditActions(admin.orgId)).toContain("user.name_changed");

    expect((await call("PATCH", "/auth/me", admin.cookie, { name: "Ana www.phishing.com" })).statusCode).toBe(400);
    expect((await call("PATCH", "/auth/me", undefined, { name: "Nadie" })).statusCode).toBe(401);
  });
});

describe("eliminar la propia cuenta", () => {
  const remove = (cookie: string, email: string, extra: object = {}) =>
    call("POST", "/auth/account/delete", cookie, { confirmEmail: email, password: PASSWORD, ...extra });

  it("exige escribir el email y la contraseña correcta", async () => {
    const admin = await registerAdmin();
    expect((await remove(admin.cookie, "otra@ejemplo.com")).statusCode).toBe(400);
    expect((await remove(admin.cookie, admin.email, { password: "incorrecta" })).statusCode).toBe(403);
    expect(await userExists(admin.userId)).toBe(true);
    expect(await auditActions(admin.orgId)).toContain("user.account_delete_failed");
  });

  it("no deja una organización sin ADMIN ni huérfana", async () => {
    const admin = await registerAdmin("Solo yo");
    const alone = await remove(admin.cookie, admin.email);
    expect(alone.statusCode).toBe(409);
    expect(alone.json().error).toContain("«Solo yo» quedaría sin nadie");

    const team = await registerAdmin("Con equipo");
    const colleague = await registerAdmin();
    await joinAs(colleague, team.orgId, "CONSULTANT");
    const res = await remove(team.cookie, team.email);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("sos el único ADMIN de «Con equipo»");
    expect(await userExists(team.userId)).toBe(true);
  });

  it("borra la cuenta, sus membresías y sesiones; la organización conserva la auditoría", async () => {
    const owner = await registerAdmin("Cliente");
    const person = await registerAdmin("Propia");
    const cookieInClient = await joinAs(person, owner.orgId, "CONSULTANT");
    // Un riesgo a su cargo y una invitación que envió: quedan, sin la persona.
    const repo = forOrganization(ctx.db, owner.orgId, person.userId);
    const risk = await repo.createRisk({ title: "Riesgo de la persona", likelihood: 2, impact: 2, ownerId: person.userId });
    await repo.createInvitation({ email: uniqueEmail(), role: "AUDITOR", tokenHash: `hash-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) });

    // Primero tiene que eliminar su propia organización (es la única persona ahí).
    const own = await call("POST", "/organization/delete", person.cookie, { confirmName: "Propia", password: PASSWORD });
    expect(own.statusCode).toBe(204);

    const res = await remove(cookieInClient, person.email);
    expect(res.statusCode).toBe(204);
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)?.value).toBe("");
    expect(await userExists(person.userId)).toBe(false);
    expect((await call("GET", "/auth/me", cookieInClient)).statusCode).toBe(401);
    expect(mailer.lastTo(person.email)?.subject).toBe("Eliminamos tu cuenta de Cumplia");

    const members = (await call("GET", "/members", owner.cookie)).json() as { userId: string }[];
    expect(members.map((m) => m.userId)).not.toContain(person.userId);
    expect((await call("GET", `/risks/${risk.id}`, owner.cookie)).json()).toMatchObject({ title: "Riesgo de la persona", ownerId: null });
    expect(await auditActions(owner.orgId)).toContain("user.account_deleted");
  });

  it("con MFA, además pide un código de la app", async () => {
    const admin = await registerAdmin("Con MFA");
    const other = await registerAdmin();
    await joinAs(other, admin.orgId, "ADMIN"); // así la organización no queda sin ADMIN
    const { secret } = (await call("POST", "/auth/mfa/setup", admin.cookie)).json() as { secret: string };
    const key = base32Decode(secret);
    expect((await call("POST", "/auth/mfa/enable", admin.cookie, { code: totp(key) })).statusCode).toBe(200);
    await ctx.db.update(schema.users).set({ mfaLastUsedStep: null }).where(eq(schema.users.id, admin.userId));

    // Su organización propia ("Con MFA") tiene otro ADMIN; no tiene más membresías.
    expect((await remove(admin.cookie, admin.email)).statusCode).toBe(403);
    expect((await remove(admin.cookie, admin.email, { code: "000000" })).statusCode).toBe(403);
    expect((await remove(admin.cookie, admin.email, { code: totp(key) })).statusCode).toBe(204);
    expect(await userExists(admin.userId)).toBe(false);
  });
});

describe("exportar los datos de la organización", () => {
  it("ADMIN descarga un ZIP con todo, archivos incluidos, sin secretos; queda auditado", async () => {
    const admin = await registerAdmin("Exporta S.A.");
    const data = await seed(admin.orgId, admin.userId);

    const res = await call("GET", "/organization/export", admin.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="Cumplia - Exporta S.A. - \d{4}-\d{2}-\d{2}\.zip"/);

    const zip = unzipSync(new Uint8Array(res.rawPayload));
    const read = (name: string) => JSON.parse(strFromU8(zip[name]!));
    expect(Object.keys(zip)).toEqual(
      expect.arrayContaining(["LEEME.txt", "organizacion.json", "miembros.json", "invitaciones.json", "evaluaciones.json", "riesgos.json", "auditoria.json"]),
    );
    expect(read("organizacion.json")).toMatchObject({ id: admin.orgId, name: "Exporta S.A." });
    expect(read("miembros.json")).toEqual([expect.objectContaining({ email: admin.email, role: "ADMIN" })]);
    const [assessment] = read("evaluaciones.json");
    expect(assessment).toMatchObject({ id: data.assessmentId, name: "Gap anual" });
    expect(assessment.answers[0]).toMatchObject({ controlId: "A.5.1", maturity: 2, justification: "Política aprobada" });
    expect(assessment.answers[0].evidence[0]).toMatchObject({ id: data.fileId, fileName: "politica.pdf" });
    expect(read("riesgos.json")[0]).toMatchObject({ id: data.riskId, title: "Fuga de datos" });
    expect(read("auditoria.json").map((l: { action: string }) => l.action)).toContain("assessment.create");
    expect(Buffer.from(zip[`evidencias/${data.assessmentId}/${data.fileId}-politica.pdf`]!)).toEqual(data.pdf);

    const everything = Object.values(zip).map((f) => strFromU8(f)).join("\n");
    for (const secret of ["tokenHash", "token_hash", "passwordHash", "mfaSecret", "fileKey", `org/${admin.orgId}/`]) {
      expect(everything, secret).not.toContain(secret);
    }
    expect(await auditActions(admin.orgId)).toContain("organization.exported");
  });

  it("solo ADMIN con email verificado", async () => {
    const admin = await registerAdmin();
    const consultant = await registerAdmin();
    const consultantCookie = await joinAs(consultant, admin.orgId, "CONSULTANT");
    expect((await call("GET", "/organization/export", consultantCookie)).statusCode).toBe(403);

    await ctx.db.update(schema.users).set({ emailVerifiedAt: null }).where(eq(schema.users.id, admin.userId));
    const res = await call("GET", "/organization/export", admin.cookie);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("no incluye nada de otra organización", async () => {
    const a = await registerAdmin("Organización A");
    const secretsOfA = await seed(a.orgId, a.userId);
    const b = await registerAdmin("Organización B");
    await seed(b.orgId, b.userId);

    const zip = unzipSync(new Uint8Array((await call("GET", "/organization/export", b.cookie)).rawPayload));
    const everything = Object.entries(zip).map(([name, f]) => `${name}\n${strFromU8(f)}`).join("\n");
    for (const s of [a.orgId, a.email, secretsOfA.assessmentId, secretsOfA.fileId, secretsOfA.riskId, "Organización A"]) {
      expect(everything, s).not.toContain(s);
    }
  });
});

describe("eliminar la organización", () => {
  const remove = (cookie: string, body: object) => call("POST", "/organization/delete", cookie, { password: PASSWORD, ...body });

  it("exige el nombre exacto, la contraseña y ser ADMIN", async () => {
    const admin = await registerAdmin("Seguros del Sur");
    await seed(admin.orgId, admin.userId);
    const consultant = await registerAdmin();
    const consultantCookie = await joinAs(consultant, admin.orgId, "CONSULTANT");

    expect((await remove(admin.cookie, { confirmName: "Seguros" })).statusCode).toBe(400);
    expect((await remove(admin.cookie, { confirmName: "Seguros del Sur", password: "incorrecta" })).statusCode).toBe(403);
    expect((await remove(consultantCookie, { confirmName: "Seguros del Sur" })).statusCode).toBe(403);
    expect((await rowsOf(admin.orgId)).assessments).toBe(1);
    expect(await auditActions(admin.orgId)).toContain("organization.delete_failed");
  });

  it("borra datos, archivos, auditoría y las cuentas que quedan sin organización; avisa a los miembros", async () => {
    const admin = await registerAdmin("Se va");
    const data = await seed(admin.orgId, admin.userId);
    const member = await registerAdmin("Otra del miembro");
    const memberCookie = await joinAs(member, admin.orgId, "AUDITOR");
    const other = await registerAdmin("Se queda");
    const otherData = await seed(other.orgId, other.userId);
    const otherRowsBefore = await rowsOf(other.orgId);

    const res = await remove(admin.cookie, { confirmName: "Se va" });
    expect(res.statusCode).toBe(204);
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)?.value).toBe("");

    expect(Object.values(await rowsOf(admin.orgId)).every((count) => count === 0)).toBe(true);
    const org = await ctx.db.select().from(schema.organizations).where(eq(schema.organizations.id, admin.orgId));
    expect(org).toHaveLength(0);
    expect(storage.objects.has(data.key)).toBe(false);
    const tombstone = await ctx.asOwner(() =>
      ctx.db.select().from(schema.organizationDeletions).where(eq(schema.organizationDeletions.organizationId, admin.orgId)),
    );
    expect(tombstone).toEqual([expect.objectContaining({ deletedBy: admin.userId })]);

    for (const to of [admin.email, member.email]) expect(mailer.lastTo(to)?.subject).toBe("Se eliminó Se va en Cumplia");
    // Quien eliminó no tenía otra organización: su cuenta ya no serviría y se borra.
    expect(await userExists(admin.userId)).toBe(false);
    expect(mailer.lastTo(admin.email)?.text).toContain("también eliminamos tu cuenta");
    // El miembro pertenece a otra: su cuenta queda.
    expect(await userExists(member.userId)).toBe(true);
    expect(mailer.lastTo(member.email)?.text).toContain("Tu cuenta sigue activa");
    expect((await call("GET", "/auth/me", memberCookie)).statusCode).toBe(401); // su sesión era en esa organización
    expect((await call("GET", "/auth/me", member.cookie)).statusCode).toBe(200); // la de su otra organización sigue

    expect(await rowsOf(other.orgId)).toEqual(otherRowsBefore);
    expect(storage.objects.has(otherData.key)).toBe(true);
  });
});

describe("la base protege la auditoría y el alcance del borrado", () => {
  it("la API no puede borrar auditoría, ni siquiera fingiendo un borrado en curso", async () => {
    const admin = await registerAdmin();
    await expect(
      ctx.db.transaction(async (tx) => {
        await setTenantContext(tx, admin.orgId);
        await tx.execute(sql`select set_config('app.purging_organization', ${admin.orgId}, true)`);
        await tx.delete(schema.auditLogs).where(eq(schema.auditLogs.organizationId, admin.orgId));
      }),
    ).rejects.toThrow();
    expect((await rowsOf(admin.orgId)).audit_logs).toBeGreaterThan(0);
  });

  it("app_purge_organization solo borra la organización fijada en la transacción", async () => {
    const a = await registerAdmin();
    const b = await registerAdmin();
    await expect(
      ctx.db.transaction(async (tx) => {
        await setTenantContext(tx, b.orgId);
        await tx.execute(sql`select app_purge_organization(${a.orgId}::uuid, null)`);
      }),
    ).rejects.toThrow();
    expect((await rowsOf(a.orgId)).memberships).toBe(1);
  });
});

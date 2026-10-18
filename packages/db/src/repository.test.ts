import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { rowLevelSecurityBypassReasons } from "./client.js";
import { createTestDb } from "./testing.js";
import { NotFoundError, createOrganization, forOrganization, setTenantContext, type Tx } from "./repository.js";
import { assessments, auditLogs, controlAnswers, evidence, memberships, sessions, users } from "./schema.js";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  ctx = await createTestDb();
});
afterAll(async () => {
  await ctx.close();
});

const setup = async () => {
  const a = await createOrganization(ctx.db, "Empresa A");
  const b = await createOrganization(ctx.db, "Empresa B");
  return { a, b, repoA: forOrganization(ctx.db, a.id), repoB: forOrganization(ctx.db, b.id) };
};

describe("aislamiento entre organizaciones", () => {
  it("una organización no ve las evaluaciones de otra", async () => {
    const { repoA, repoB } = await setup();
    const asm = await repoA.createAssessment("iso27001-2022");
    expect(await repoA.getAssessment(asm.id)).not.toBeNull();
    expect(await repoB.getAssessment(asm.id)).toBeNull();
    expect(await repoB.listAssessments()).toHaveLength(0);
  });

  it("no puede escribir respuestas en la evaluación de otra organización", async () => {
    const { repoA, repoB } = await setup();
    const asm = await repoA.createAssessment("iso27001-2022");
    await repoA.saveAnswers(asm.id, [{ controlId: "A.5.1", applicable: true, maturity: 1 }]);
    await expect(
      repoB.saveAnswers(asm.id, [{ controlId: "A.5.1", applicable: true, maturity: 4 }]),
    ).rejects.toBeInstanceOf(NotFoundError);
    const [still] = await repoA.getAnswers(asm.id);
    expect(still?.maturity).toBe(1);
  });

  it("no puede calcular ni agregar evidencia sobre datos ajenos", async () => {
    const { repoA, repoB } = await setup();
    const asm = await repoA.createAssessment("iso27001-2022");
    await repoA.saveAnswers(asm.id, [{ controlId: "A.8.5", applicable: true, maturity: 2 }]);
    await expect(repoB.computeResult(asm.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(repoB.addEvidence(asm.id, "A.8.5", "manual", "x")).rejects.toBeInstanceOf(NotFoundError);
    expect(await repoB.getAnswers(asm.id)).toHaveLength(0);
  });

  it("el registro de auditoría es por organización", async () => {
    const { repoA, repoB } = await setup();
    await repoA.createAssessment("iso27001-2022");
    expect(await repoA.listAuditLog()).toHaveLength(1);
    expect(await repoB.listAuditLog()).toHaveLength(0);
  });
});

describe("evaluaciones", () => {
  it("guarda respuestas, actualiza (upsert) y calcula el puntaje", async () => {
    const { repoA } = await setup();
    const asm = await repoA.createAssessment("iso27001-2022");
    await repoA.saveAnswers(asm.id, [
      { controlId: "A.5.1", applicable: true, maturity: 2 },
      { controlId: "A.7.1", applicable: false, justification: "Trabajo 100% remoto" },
    ]);
    await repoA.saveAnswers(asm.id, [{ controlId: "A.5.1", applicable: true, maturity: 4 }]);
    const answers = await repoA.getAnswers(asm.id);
    expect(answers).toHaveLength(2);
    expect(answers.find((x) => x.controlId === "A.5.1")?.maturity).toBe(4);
    const result = await repoA.computeResult(asm.id);
    expect(result.notApplicable).toBe(1);
    expect(result.applicable).toBe(92);
  });

  it("rechaza no aplicable sin justificación y controles inexistentes", async () => {
    const { repoA } = await setup();
    const asm = await repoA.createAssessment("iso27001-2022");
    await expect(repoA.saveAnswers(asm.id, [{ controlId: "A.5.1", applicable: false }])).rejects.toThrow();
    await expect(repoA.saveAnswers(asm.id, [{ controlId: "A.99.9", applicable: true, maturity: 1 }])).rejects.toThrow();
  });

  it("rechaza marcos inexistentes", async () => {
    const { repoA } = await setup();
    await expect(repoA.createAssessment("no-existe")).rejects.toThrow();
  });

  it("guarda evidencia y la audita", async () => {
    const { repoA } = await setup();
    const asm = await repoA.createAssessment("iso27001-2022");
    await repoA.saveAnswers(asm.id, [{ controlId: "A.8.5", applicable: true, maturity: 3 }]);
    const ev = await repoA.addEvidence(asm.id, "A.8.5", "manual", "MFA activo para todos los usuarios");
    expect(ev.source).toBe("manual");
    const actions = (await repoA.listAuditLog()).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["assessment.create", "answers.save", "evidence.add"]));
  });
});

// Estas pruebas corren como dueño (sin RLS) a propósito: verifican que la
// restricción misma rechaza el dato, no que RLS lo oculte.
describe("restricciones de la base de datos", () => {
  it("impide una madurez fuera de 0-4 aunque se salte el código", async () => {
    const { a } = await setup();
    const asm = await forOrganization(ctx.db, a.id).createAssessment("iso27001-2022");
    await ctx.asOwner(() =>
      expect(
        ctx.db.execute(
          sql`insert into control_answers (organization_id, assessment_id, control_id, maturity)
              values (${a.id}, ${asm.id}, 'A.5.1', 9)`,
        ),
      ).rejects.toThrow(),
    );
  });

  it("impide una respuesta de una organización colgada de la evaluación de otra", async () => {
    const { a, b } = await setup();
    const asm = await forOrganization(ctx.db, a.id).createAssessment("iso27001-2022");
    await ctx.asOwner(() =>
      expect(
        ctx.db.insert(controlAnswers).values({ organizationId: b.id, assessmentId: asm.id, controlId: "A.5.1", maturity: 1 }),
      ).rejects.toThrow(),
    );
  });

  it("impide evidencia de una organización sobre la respuesta de otra", async () => {
    const { b, repoA } = await setup();
    const asm = await repoA.createAssessment("iso27001-2022");
    await repoA.saveAnswers(asm.id, [{ controlId: "A.5.1", applicable: true, maturity: 1 }]);
    await ctx.asOwner(async () => {
      const [answer] = await ctx.db.select().from(controlAnswers).where(eq(controlAnswers.assessmentId, asm.id));
      await expect(
        ctx.db.insert(evidence).values({ organizationId: b.id, controlAnswerId: answer!.id, source: "manual", description: "x" }),
      ).rejects.toThrow();
    });
  });

  it("impide una sesión en una organización de la que el usuario no es miembro", async () => {
    const { a, b } = await setup();
    const [user] = await ctx.db.insert(users).values({ email: `s${Date.now()}@ejemplo.com` }).returning();
    await ctx.db.insert(memberships).values({ userId: user!.id, organizationId: a.id, role: "CONSULTANT" });
    const expiresAt = new Date(Date.now() + 60_000);
    await expect(
      ctx.db.insert(sessions).values({ userId: user!.id, organizationId: b.id, tokenHash: `t-${Date.now()}`, expiresAt }),
    ).rejects.toThrow();

    // Y al quitar la membresía, sus sesiones desaparecen en cascada.
    await ctx.db.insert(sessions).values({ userId: user!.id, organizationId: a.id, tokenHash: `ok-${Date.now()}`, expiresAt });
    await ctx.db.delete(memberships).where(eq(memberships.userId, user!.id));
    expect(await ctx.db.select().from(sessions).where(eq(sessions.userId, user!.id))).toHaveLength(0);
  });

  it("el registro de auditoría no se puede modificar ni borrar", async () => {
    const { repoA } = await setup();
    await repoA.createAssessment("iso27001-2022");
    const [entry] = await repoA.listAuditLog();
    const update = () => ctx.db.update(auditLogs).set({ action: "nada" }).where(eq(auditLogs.id, entry!.id));
    const remove = () => ctx.db.delete(auditLogs).where(eq(auditLogs.id, entry!.id));
    const truncate = () => ctx.db.execute(sql`truncate audit_logs`);

    // La API ni siquiera tiene permiso...
    for (const op of [update, remove, truncate]) expect(await errorOf(op())).toMatch(/permission denied/);
    // ...y aunque lo tuviera (el dueño), el trigger lo impide.
    await ctx.asOwner(async () => {
      for (const op of [update, remove, truncate]) expect(await errorOf(op())).toMatch(/solo agregar/);
    });
    expect(await repoA.listAuditLog()).toHaveLength(1);
  });

  it("impide un objetivo de madurez inválido", async () => {
    const { a } = await setup();
    await ctx.asOwner(() =>
      expect(
        ctx.db.insert(assessments).values({ organizationId: a.id, frameworkId: "iso27001-2022", targetMaturity: 7 }),
      ).rejects.toThrow(),
    );
  });
});

/** Mensaje del error de Postgres (drizzle lo envuelve: el original viene en `cause`). */
const errorOf = (query: PromiseLike<unknown>) =>
  Promise.resolve(query).then(
    () => "sin error",
    (e: Error & { cause?: Error }) => e.cause?.message ?? e.message,
  );

describe("Row-Level Security", () => {
  /** Ejecuta `fn` con la organización activa fijada, como hace forOrganization. */
  const asTenant = <T>(organizationId: string, fn: (tx: Tx) => Promise<T>) =>
    ctx.db.transaction(async (tx) => {
      await setTenantContext(tx, organizationId);
      return fn(tx);
    });

  const seedA = async () => {
    const { a, b, repoA } = await setup();
    const asm = await repoA.createAssessment("iso27001-2022");
    await repoA.saveAnswers(asm.id, [{ controlId: "A.5.1", applicable: true, maturity: 2 }]);
    await repoA.addEvidence(asm.id, "A.5.1", "manual", "evidencia");
    return { a, b, asm };
  };

  it("sin organización activa, la API no ve ninguna fila de negocio", async () => {
    await seedA();
    for (const table of [assessments, controlAnswers, evidence, auditLogs]) {
      expect(await ctx.db.select().from(table)).toHaveLength(0);
    }
    // Pero los datos existen (el dueño los ve).
    expect((await ctx.asOwner(() => ctx.db.select().from(assessments))).length).toBeGreaterThan(0);
  });

  it("una consulta SIN filtro por organización solo devuelve filas de la activa", async () => {
    const { a, b, asm } = await seedA();
    const seenByB = await asTenant(b.id, (tx) => tx.select().from(assessments));
    expect(seenByB.find((r) => r.id === asm.id)).toBeUndefined();
    const seenByA = await asTenant(a.id, (tx) => tx.select().from(assessments));
    expect(seenByA.every((r) => r.organizationId === a.id)).toBe(true);
    expect(seenByA.find((r) => r.id === asm.id)).toBeDefined();
  });

  it("no deja escribir, modificar ni borrar filas de otra organización", async () => {
    const { a, b, asm } = await seedA();
    await asTenant(b.id, async (tx) => {
      expect(await errorOf(tx.insert(assessments).values({ organizationId: a.id, frameworkId: "iso27001-2022" }))).toMatch(
        /row-level security/,
      );
    });
    // UPDATE/DELETE sobre filas invisibles no afectan nada.
    const updated = await asTenant(b.id, (tx) => tx.update(assessments).set({ targetMaturity: 1 }).where(eq(assessments.id, asm.id)).returning());
    const deleted = await asTenant(b.id, (tx) => tx.delete(assessments).where(eq(assessments.id, asm.id)).returning());
    expect(updated).toHaveLength(0);
    expect(deleted).toHaveLength(0);
    expect((await forOrganization(ctx.db, a.id).getAssessment(asm.id))?.targetMaturity).toBe(3);
  });

  it("el contexto no sobrevive a la transacción", async () => {
    const { a } = await seedA();
    expect((await asTenant(a.id, (tx) => tx.select().from(assessments))).length).toBeGreaterThan(0);
    expect(await ctx.db.select().from(assessments)).toHaveLength(0);
  });

  it("detecta si la conexión se saltearía RLS", async () => {
    expect(await rowLevelSecurityBypassReasons(ctx.db)).toEqual([]);
    const asOwner = await ctx.asOwner(() => rowLevelSecurityBypassReasons(ctx.db));
    expect(asOwner.join(" ")).toMatch(/superusuario/);
  });

  it("toda tabla con organization_id tiene RLS forzado, salvo las de identidad", async () => {
    // Sesiones, desafíos y membresías se consultan ANTES de saber la organización
    // (login, cookie); su aislamiento lo dan las FK a la membresía y el código.
    const identityTables = ["sessions", "mfa_challenges", "memberships"];
    const result = await ctx.db.execute<{ table: string; rls: boolean; forced: boolean; policies: number }>(sql`
      select c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
             (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped
      where c.relkind = 'r'`);
    const tables = result.rows.filter((r) => !identityTables.includes(r.table));
    expect(tables.map((t) => t.table).sort()).toEqual(["assessments", "audit_logs", "control_answers", "evidence", "invitations", "risks"]);
    for (const t of tables) {
      expect(t, t.table).toMatchObject({ rls: true, forced: true });
      expect(t.policies, t.table).toBeGreaterThanOrEqual(1);
    }
  });
});

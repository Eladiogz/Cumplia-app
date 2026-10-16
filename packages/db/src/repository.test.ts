import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "./testing.js";
import { NotFoundError, createOrganization, forOrganization } from "./repository.js";
import { assessments } from "./schema.js";

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

describe("restricciones de la base de datos", () => {
  it("impide una madurez fuera de 0-4 aunque se salte el código", async () => {
    const { a } = await setup();
    const asm = await forOrganization(ctx.db, a.id).createAssessment("iso27001-2022");
    await expect(
      ctx.db.execute(
        sql`insert into control_answers (organization_id, assessment_id, control_id, maturity)
            values (${a.id}, ${asm.id}, 'A.5.1', 9)`,
      ),
    ).rejects.toThrow();
  });

  it("impide un objetivo de madurez inválido", async () => {
    const { a } = await setup();
    await expect(
      ctx.db.insert(assessments).values({ organizationId: a.id, frameworkId: "iso27001-2022", targetMaturity: 7 }),
    ).rejects.toThrow();
  });
});

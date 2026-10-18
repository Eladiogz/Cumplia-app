import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./testing.js";
import { NotFoundError, ValidationError, createOrganization, forOrganization } from "./repository.js";
import { memberships, risks, users } from "./schema.js";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  ctx = await createTestDb();
});
afterAll(async () => {
  await ctx.close();
});

let n = 0;
const setup = async () => {
  const a = await createOrganization(ctx.db, "Empresa A");
  const b = await createOrganization(ctx.db, "Empresa B");
  const [memberA] = await ctx.db.insert(users).values({ email: `riesgos-a${++n}@ejemplo.com`, name: "Ana" }).returning();
  const [memberB] = await ctx.db.insert(users).values({ email: `riesgos-b${n}@ejemplo.com` }).returning();
  await ctx.db.insert(memberships).values([
    { userId: memberA!.id, organizationId: a.id, role: "CONSULTANT" },
    { userId: memberB!.id, organizationId: b.id, role: "CONSULTANT" },
  ]);
  return { a, b, memberA: memberA!, memberB: memberB!, repoA: forOrganization(ctx.db, a.id), repoB: forOrganization(ctx.db, b.id) };
};

const base = { title: "Ransomware en el servidor de archivos", likelihood: 3, impact: 5 };

describe("registro de riesgos", () => {
  it("numera correlativo POR organización, también con altas simultáneas", async () => {
    const { repoA, repoB } = await setup();
    const created = await Promise.all(Array.from({ length: 5 }, (_, i) => repoA.createRisk({ ...base, title: `Riesgo ${i}` })));
    expect(created.map((r) => r.number).sort()).toEqual([1, 2, 3, 4, 5]);
    expect((await repoB.createRisk(base)).number).toBe(1);
  });

  it("guarda con valores por defecto, normaliza controles y trae al responsable", async () => {
    const { repoA, memberA } = await setup();
    const r = await repoA.createRisk({ ...base, controlIds: ["A.8.13", "A.5.1", "A.8.13", "A.8.7"], ownerId: memberA.id });
    expect(r).toMatchObject({ treatment: "mitigate", status: "identified", ownerName: "Ana", ownerEmail: memberA.email });
    expect(r.controlIds).toEqual(["A.5.1", "A.8.7", "A.8.13"]);
  });

  it("rechaza controles inexistentes y decisiones incoherentes", async () => {
    const { repoA } = await setup();
    await expect(repoA.createRisk({ ...base, controlIds: ["A.9.99"] })).rejects.toThrow(/Controles desconocidos/);
    await expect(repoA.createRisk({ ...base, treatment: "accept" })).rejects.toBeInstanceOf(ValidationError);
    await expect(repoA.createRisk({ ...base, status: "accepted" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("valida los cambios parciales sobre el riesgo resultante", async () => {
    const { repoA } = await setup();
    const r = await repoA.createRisk(base);
    await expect(repoA.updateRisk(r.id, { treatment: "accept" })).rejects.toThrow(/justificación/);
    const accepted = await repoA.updateRisk(r.id, { treatment: "accept", treatmentPlan: "Costo del control mayor al impacto", status: "accepted" });
    expect(accepted.status).toBe("accepted");
    // Ya aceptado: cambiar el tratamiento sin cambiar el estado sería incoherente.
    await expect(repoA.updateRisk(r.id, { treatment: "mitigate" })).rejects.toThrow(/Aceptado/);
    await expect(repoA.updateRisk(r.id, { residualLikelihood: 2 })).rejects.toThrow(/residual/);
  });

  it("el responsable tiene que ser miembro de la organización", async () => {
    const { repoA, memberB } = await setup();
    await expect(repoA.createRisk({ ...base, ownerId: memberB.id })).rejects.toThrow(/miembro/);
    const r = await repoA.createRisk(base);
    await expect(repoA.updateRisk(r.id, { ownerId: memberB.id })).rejects.toThrow(/miembro/);
  });

  it("la base impide un responsable de otra organización aunque se saltee la API", async () => {
    const { a, memberB } = await setup();
    await ctx.asOwner(() =>
      expect(
        ctx.db.insert(risks).values({ organizationId: a.id, number: 99, ...base, ownerId: memberB.id }),
      ).rejects.toThrow(),
    );
  });

  it("si el responsable deja la organización, el riesgo queda sin responsable", async () => {
    const { repoA, memberA } = await setup();
    const r = await repoA.createRisk({ ...base, ownerId: memberA.id });
    await repoA.removeMember(memberA.id);
    const after = await repoA.getRisk(r.id);
    expect(after.ownerId).toBeNull();
    expect(after.title).toBe(base.title);
    expect((await repoA.listRisks()).map((x) => x.id)).toContain(r.id);
  });

  it("otra organización no ve, no cambia ni borra el riesgo", async () => {
    const { repoA, repoB } = await setup();
    const r = await repoA.createRisk(base);
    await expect(repoB.getRisk(r.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(repoB.updateRisk(r.id, { status: "closed" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(repoB.deleteRisk(r.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await repoB.listRisks()).toHaveLength(0);
    expect((await repoA.getRisk(r.id)).status).toBe("identified");
  });

  it("audita alta, cambios (solo lo que cambió) y baja", async () => {
    const { repoA } = await setup();
    const r = await repoA.createRisk(base);
    await repoA.updateRisk(r.id, { likelihood: 2, title: base.title });
    await repoA.deleteRisk(r.id);
    const log = await repoA.listAuditLog();
    expect(log.map((l) => l.action)).toEqual(["risk.delete", "risk.update", "risk.create"]);
    expect(log[1]!.details).toEqual({ number: 1, likelihood: 2 });
    expect(log[0]!.details).toMatchObject({ number: 1, title: base.title });
    await expect(repoA.getRisk(r.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { outboxStatus, schema } from "@cumplia/db";
import { createTestDb } from "@cumplia/db/testing";
import { buildApp } from "../app.js";
import { MemoryMailer, type EmailMessage, type Mailer } from "./mailer.js";
import { createOutbox, deriveOutboxKey, retryDelaySeconds } from "./outbox.js";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  ctx = await createTestDb();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await ctx.db.delete(schema.emailOutbox);
});

const key = deriveOutboxKey(randomBytes(32));
const message = (to = "ana@ejemplo.com"): EmailMessage => ({
  to,
  subject: "Restablecé tu contraseña",
  text: "Entrá a https://app.example/restablecer#token=SECRETO-123",
  html: "<a href='https://app.example/restablecer#token=SECRETO-123'>Restablecer</a>",
});

/** Transporte que falla las primeras `failures` veces. */
class FlakyTransport implements Mailer {
  readonly sent: EmailMessage[] = [];
  constructor(private failures: number) {}
  async send(m: EmailMessage) {
    if (this.failures-- > 0) throw new Error("SMTP 421: servicio no disponible");
    this.sent.push(m);
  }
}

const rows = () => ctx.db.select().from(schema.emailOutbox);
const makeDue = () => ctx.db.update(schema.emailOutbox).set({ nextAttemptAt: sql`now() - interval '1 second'` });

describe("cola de emails", () => {
  it("guarda el email cifrado y lo entrega; enviado, la fila desaparece", async () => {
    const transport = new MemoryMailer();
    const outbox = createOutbox({ db: ctx.db, key, transport });
    await outbox.mailer.send(message());
    await outbox.flush();
    expect(transport.sent).toEqual([message()]);
    expect(await rows()).toHaveLength(0);
  });

  it("en la base el contenido no se puede leer (ni el destinatario ni el token)", async () => {
    const transport = new FlakyTransport(99);
    const outbox = createOutbox({ db: ctx.db, key, transport });
    await outbox.mailer.send(message());
    await outbox.flush();
    const [row] = await rows();
    expect(row!.payload).toBeTruthy();
    expect(row!.payload).not.toContain("SECRETO-123");
    expect(row!.payload).not.toContain("ana@ejemplo.com");
  });

  it("si el SMTP falla, reintenta más tarde (no antes) y termina entregando", async () => {
    const transport = new FlakyTransport(1);
    const errors: { final: boolean }[] = [];
    const outbox = createOutbox({ db: ctx.db, key, transport, onError: (e) => errors.push(e) });
    await outbox.mailer.send(message());
    await outbox.flush();
    const [row] = await rows();
    expect(row).toMatchObject({ attempts: 1, lastError: "SMTP 421: servicio no disponible", failedAt: null });
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
    expect(errors).toEqual([expect.objectContaining({ final: false })]);

    // Antes de la hora de reintento no se toca.
    await outbox.flush();
    expect(transport.sent).toHaveLength(0);

    await makeDue();
    await outbox.flush();
    expect(transport.sent).toHaveLength(1);
    expect(await rows()).toHaveLength(0);
  });

  it("después del máximo de intentos lo da por perdido y borra el contenido", async () => {
    const transport = new FlakyTransport(99);
    const errors: { final: boolean }[] = [];
    const outbox = createOutbox({ db: ctx.db, key, transport, maxAttempts: 3, onError: (e) => errors.push(e) });
    await outbox.mailer.send(message());
    for (let i = 0; i < 3; i++) {
      await outbox.flush();
      await makeDue();
    }
    const [row] = await rows();
    expect(row).toMatchObject({ attempts: 3, payload: null });
    expect(row!.failedAt).not.toBeNull();
    expect(errors.map((e) => e.final)).toEqual([false, false, true]);
    expect(await outboxStatus(ctx.db)).toEqual({ pending: 0, failed: 1 });

    await outbox.flush(); // ya no se reintenta
    expect((await rows())[0]!.attempts).toBe(3);
  });

  it("contenido copiado de otra fila o con otra clave: no se envía", async () => {
    const transport = new MemoryMailer();
    const outbox = createOutbox({ db: ctx.db, key, transport: new FlakyTransport(99), maxAttempts: 99 });
    await outbox.mailer.send(message("victima@ejemplo.com"));
    await outbox.flush();
    const [original] = await rows();
    // Alguien con acceso a la base copia el contenido a una fila nueva.
    await ctx.db.insert(schema.emailOutbox).values({ id: crypto.randomUUID(), payload: original!.payload });
    await ctx.db.delete(schema.emailOutbox).where(eq(schema.emailOutbox.id, original!.id));

    await createOutbox({ db: ctx.db, key, transport }).flush();
    expect(transport.sent).toHaveLength(0);
    const [copy] = await rows();
    expect(copy!.failedAt).not.toBeNull();

    // Cifrado con otra clave (p. ej. la rotaron sin migrar la cola): tampoco se abre.
    await ctx.db.delete(schema.emailOutbox);
    const other = createOutbox({ db: ctx.db, key: deriveOutboxKey(randomBytes(32)), transport: new FlakyTransport(99) });
    await other.mailer.send(message());
    await other.flush();
    await makeDue();
    await createOutbox({ db: ctx.db, key, transport }).flush();
    expect(transport.sent).toHaveLength(0);
    expect((await rows())[0]!.failedAt).not.toBeNull();
  });

  it("dos procesos a la vez no envían el mismo email dos veces", async () => {
    const transport = new MemoryMailer();
    const a = createOutbox({ db: ctx.db, key, transport, batchSize: 3 });
    const b = createOutbox({ db: ctx.db, key, transport, batchSize: 3 });
    const enqueue = createOutbox({ db: ctx.db, key, transport: new FlakyTransport(999) });
    for (let i = 0; i < 10; i++) await enqueue.mailer.send(message(`p${i}@ejemplo.com`));
    await enqueue.flush(); // que termine su envío en segundo plano (falla a propósito)
    await ctx.db
      .update(schema.emailOutbox)
      .set({ attempts: 0, lastError: null, lockedUntil: null, nextAttemptAt: sql`now() - interval '1 second'` });

    await Promise.all([a.flush(), b.flush(), a.flush(), b.flush()]);
    const delivered = transport.sent.map((m) => m.to).sort();
    expect(delivered).toHaveLength(10);
    expect(new Set(delivered).size).toBe(10);
  });

  it("espera creciente entre intentos, con tope de una hora", () => {
    expect([1, 2, 3, 4, 7, 8].map(retryDelaySeconds)).toEqual([60, 120, 240, 480, 3600, 3600]);
  });

  it("de punta a punta: un email de la API llega a través de la cola", async () => {
    const transport = new MemoryMailer();
    const outbox = createOutbox({ db: ctx.db, key, transport });
    const app = buildApp({ db: ctx.db, mailer: outbox.mailer, authRateLimit: 1000, mfaEncryptionKey: randomBytes(32) });
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "cola@ejemplo.com", password: "Clave-Segura-de-Prueba-2026", organizationName: "Cola SA" },
    });
    await outbox.flush();
    expect(transport.lastTo("cola@ejemplo.com")?.subject).toMatch(/Confirmá tu email/);
    await app.close();
  });
});

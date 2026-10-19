import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { emailOutbox } from "./schema.js";

/** Encola un email ya cifrado. El id lo elige quien cifra: el cifrado queda atado a esta fila. */
export async function enqueueEmail(db: Db, id: string, payload: string) {
  await db.insert(emailOutbox).values({ id, payload });
}

export interface ClaimedEmail {
  id: string;
  payload: string;
  attempts: number;
}

/**
 * Reserva hasta `limit` emails listos para enviar, de forma atómica (`FOR UPDATE SKIP
 * LOCKED`): dos procesos nunca toman el mismo. Cuenta el intento al reservarlo, así
 * un proceso que se cae a mitad de envío no reintenta para siempre.
 */
export async function claimEmails(db: Db, { limit = 10, lockSeconds = 120 } = {}): Promise<ClaimedEmail[]> {
  // CTE materializado: la selección (con sus bloqueos) se evalúa UNA vez. Con
  // "where id in (subconsulta)", Postgres puede reevaluarla ante cambios concurrentes.
  type Row = { id: string; payload: string; attempts: number | string };
  // node-postgres y PGlite devuelven ambos `{ rows }`; el tipo genérico de Db no lo expresa.
  const { rows } = (await db.execute(sql`
    with picked as materialized (
      select id from email_outbox
       where failed_at is null
         and payload is not null
         and next_attempt_at <= now()
         and (locked_until is null or locked_until < now())
       order by created_at
       limit ${limit}
       for update skip locked
    )
    update email_outbox e
       set locked_until = now() + make_interval(secs => ${lockSeconds}),
           attempts = e.attempts + 1
      from picked
     where e.id = picked.id
    returning e.id, e.payload, e.attempts`)) as unknown as { rows: Row[] };
  return rows.map((r) => ({ id: r.id, payload: r.payload, attempts: Number(r.attempts) }));
}

/** Enviado: la fila (y su contenido) desaparece. */
export async function markEmailSent(db: Db, id: string) {
  await db.delete(emailOutbox).where(eq(emailOutbox.id, id));
}

/** Falló este intento: se reintenta en `retryInSeconds`, o se da por perdido (sin contenido) si es null. */
export async function markEmailFailed(db: Db, id: string, error: string, retryInSeconds: number | null) {
  const lastError = error.slice(0, 500);
  if (retryInSeconds === null) {
    await db
      .update(emailOutbox)
      .set({ failedAt: sql`now()`, payload: null, lockedUntil: null, lastError })
      .where(eq(emailOutbox.id, id));
    return;
  }
  await db
    .update(emailOutbox)
    .set({ nextAttemptAt: sql`now() + make_interval(secs => ${retryInSeconds})`, lockedUntil: null, lastError })
    .where(eq(emailOutbox.id, id));
}

/** Estado de la cola (para monitoreo): pendientes y fallidos definitivos. */
export async function outboxStatus(db: Db) {
  const [row] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${emailOutbox.failedAt} is null)::int`,
      failed: sql<number>`count(*) filter (where ${emailOutbox.failedAt} is not null)::int`,
    })
    .from(emailOutbox);
  return { pending: row?.pending ?? 0, failed: row?.failed ?? 0 };
}

/** Borra los registros de fallos definitivos más viejos que `days` (no tienen contenido). */
export async function purgeFailedEmails(db: Db, days = 30) {
  await db
    .delete(emailOutbox)
    .where(and(lt(emailOutbox.failedAt, sql`now() - make_interval(days => ${days})`), isNull(emailOutbox.payload)));
}

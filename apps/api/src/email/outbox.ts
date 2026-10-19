import { hkdfSync, randomUUID } from "node:crypto";
import { claimEmails, enqueueEmail, markEmailFailed, markEmailSent, purgeFailedEmails, type Db } from "@cumplia/db";
import { decrypt, encrypt } from "../security/encryption.js";
import type { EmailMessage, Mailer } from "./mailer.js";

/** Espera antes del intento n+1: 1, 2, 4, 8, 16, 32 y 60 minutos (≈ 2 horas en total). */
export const retryDelaySeconds = (attempts: number) => Math.min(2 ** (attempts - 1), 60) * 60;
export const MAX_ATTEMPTS = 8;

/**
 * Clave propia de la cola, derivada (HKDF) de la clave maestra: usar la misma clave
 * para dos propósitos distintos haría que un error en uno afecte al otro.
 */
export const deriveOutboxKey = (masterKey: Buffer) =>
  Buffer.from(hkdfSync("sha256", masterKey, Buffer.alloc(0), "cumplia/email-outbox/v1", 32));

/** El cifrado queda atado a la fila: copiar el contenido de un email a otra fila no sirve. */
const context = (id: string) => `email-outbox:${id}`;

interface OutboxOptions {
  db: Db;
  key: Buffer;
  /** Quien entrega de verdad (SMTP; en desarrollo, el log). */
  transport: Mailer;
  onError?: (info: { id: string; attempts: number; error: string; final: boolean }) => void;
  maxAttempts?: number;
  batchSize?: number;
}

/**
 * Cola de emails: `mailer.send` guarda el email (cifrado) en la base y avisa al
 * proceso de envío. Un fallo del SMTP ya no pierde el email: se reintenta con
 * espera creciente. Con varias instancias de la API, cada email se envía una vez.
 */
export function createOutbox({ db, key, transport, onError, maxAttempts = MAX_ATTEMPTS, batchSize = 10 }: OutboxOptions) {
  let running: Promise<number> | null = null;
  let again = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  /** Envía lo que está listo. Devuelve cuántos emails entregó. */
  const runOnce = async (): Promise<number> => {
    let delivered = 0;
    for (;;) {
      const batch = await claimEmails(db, { limit: batchSize });
      for (const email of batch) {
        const fail = async (err: unknown, final: boolean) => {
          const error = err instanceof Error ? err.message : String(err);
          await markEmailFailed(db, email.id, error, final ? null : retryDelaySeconds(email.attempts));
          onError?.({ id: email.id, attempts: email.attempts, error, final });
        };
        let message: EmailMessage;
        try {
          message = JSON.parse(decrypt(key, email.payload, context(email.id)).toString("utf8")) as EmailMessage;
        } catch (err) {
          // Contenido ilegible (clave cambiada o fila alterada): reintentar no lo arregla.
          await fail(err, true);
          continue;
        }
        try {
          await transport.send(message);
        } catch (err) {
          await fail(err, email.attempts >= maxAttempts);
          continue;
        }
        await markEmailSent(db, email.id);
        delivered++;
      }
      // Se sigue mientras haya algo: un lote incompleto no prueba que la cola esté vacía
      // (otro proceso puede tener filas reservadas). Lo que falla queda para más tarde.
      if (batch.length === 0) break;
    }
    return delivered;
  };

  /** Una sola pasada a la vez por proceso; si llegan avisos durante una, se hace otra al terminar. */
  const kick = (): Promise<number> => {
    if (running) {
      again = true;
      return running;
    }
    running = runOnce().finally(() => {
      running = null;
      if (again) {
        again = false;
        void kick();
      }
    });
    return running;
  };

  const mailer: Mailer = {
    async send(message: EmailMessage) {
      const id = randomUUID();
      await enqueueEmail(db, id, encrypt(key, Buffer.from(JSON.stringify(message)), context(id)));
      // Sin esperar: la petición responde ya; el envío sigue en segundo plano.
      kick().catch(() => undefined);
    },
  };

  /** Espera también la pasada extra que se encadena si llegaron avisos durante otra. */
  const idle = async () => {
    while (running) await running;
  };

  return {
    mailer,
    /** Procesa la cola ahora y espera a que no quede ninguna pasada en curso (tests y apagado). */
    async flush() {
      await kick();
      await idle();
    },
    /** Revisa la cola cada `intervalMs` (reintentos y emails de otras instancias). */
    start(intervalMs = 15_000) {
      timer ??= setInterval(() => {
        kick().catch((err: unknown) => onError?.({ id: "-", attempts: 0, error: String(err), final: false }));
        purgeFailedEmails(db).catch(() => undefined);
      }, intervalMs);
      timer.unref?.();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      await idle();
    },
  };
}

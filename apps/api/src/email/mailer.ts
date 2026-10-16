import type { FastifyBaseLogger } from "fastify";
import nodemailer from "nodemailer";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

/** Producción: cualquier proveedor SMTP (`smtps://usuario:clave@host:465`). */
export function createSmtpMailer(url: string, from: string): Mailer {
  const transport = nodemailer.createTransport(url);
  return {
    async send(message) {
      await transport.sendMail({ from, ...message });
    },
  };
}

/** Desarrollo sin servidor de correo: el email (con sus links) sale por el log. NUNCA en producción. */
export function createLogMailer(log: FastifyBaseLogger): Mailer {
  return {
    async send({ to, subject, text }) {
      log.info({ to, subject }, `Email (no enviado, solo desarrollo):\n${text}`);
    },
  };
}

/** Tests: guarda los emails en memoria. */
export class MemoryMailer implements Mailer {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage) {
    this.sent.push(message);
  }

  /** Último email enviado a esa dirección. */
  lastTo(to: string) {
    return this.sent.filter((m) => m.to === to).at(-1);
  }
}

/**
 * Aviso que no debe bloquear ni hacer fallar la petición: se envía en segundo plano
 * y un error solo se registra. Además evita que la demora del envío revele algo
 * (p. ej. que una cuenta existe y acaba de bloquearse).
 */
export function notify(mailer: Mailer, log: FastifyBaseLogger, message: EmailMessage) {
  mailer.send(message).catch((err: unknown) => log.error({ err, subject: message.subject }, "No se pudo enviar el email"));
}

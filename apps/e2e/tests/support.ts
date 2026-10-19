import { createHmac } from "node:crypto";
import { expect, test as base, type Page } from "@playwright/test";
import { MAILPIT_URL } from "../env.js";

export { expect };

/**
 * `page` vigilada: cualquier violación de la Content Security Policy o error de
 * JavaScript en el navegador hace fallar la prueba, aunque el resto pase.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const problems: string[] = [];
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (e) =>
        console.error(`CSP-VIOLATION ${e.violatedDirective} ${e.blockedURI}`),
      );
    });
    page.on("console", (m) => {
      if (m.text().startsWith("CSP-VIOLATION")) problems.push(m.text());
    });
    page.on("pageerror", (e) => problems.push(`Error JS: ${e.message}`));
    await use(page);
    expect(problems, "violaciones de CSP o errores de JavaScript").toEqual([]);
  },
});

/** Cumple la política de contraseñas (12+ caracteres, mayúscula, número, símbolo). */
export const PASSWORD = "Mate-Amargo-con-Facturas-2026";

let counter = 0;
export const uniqueEmail = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}@e2e.test`;

export interface Account {
  email: string;
  name: string;
  organization: string;
}

export const newAccount = (prefix: string): Account => {
  const email = uniqueEmail(prefix);
  return { email, name: "Ana Prueba", organization: `Org ${email.split("@")[0]}` };
};

/** Registra una organización desde la web y queda adentro (inicio). */
export async function register(page: Page, account: Account) {
  await page.goto("/registro");
  await page.getByLabel("Organización").fill(account.organization);
  await page.getByLabel("Tu nombre (opcional)").fill(account.name);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Repetí la contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("heading", { name: `Hola, ${account.name.split(" ")[0]}` })).toBeVisible();
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/ingresar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "Menú de usuario" }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/ingresar/);
}

// ---------- Emails (Mailpit) ----------

interface MailSummary {
  ID: string;
  Subject: string;
}

/** Último email a `to` cuyo asunto contiene `subject` (espera a que llegue: la cola es asíncrona). */
export async function waitForEmail(to: string, subject: string): Promise<{ subject: string; text: string }> {
  let found: MailSummary | undefined;
  await expect
    .poll(
      async () => {
        const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
        const { messages } = (await res.json()) as { messages: MailSummary[] };
        found = messages.find((m) => m.Subject.includes(subject));
        return found !== undefined;
      },
      { message: `email "${subject}" a ${to}`, timeout: 20_000 },
    )
    .toBe(true);
  const message = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${found!.ID}`)).json()) as { Subject: string; Text: string };
  return { subject: message.Subject, text: message.Text };
}

/** El link con token de un email (los tokens van en el fragmento #). */
export function linkIn(text: string): string {
  const match = text.match(/https?:\/\/[^\s<>()]+#token=[^\s<>()]+/);
  if (!match) throw new Error(`El email no trae un link con token:\n${text}`);
  return match[0];
}

/** Confirma el email de la cuenta con el link que llegó por correo. */
export async function verifyEmail(page: Page, email: string) {
  const mail = await waitForEmail(email, "Confirmá tu email");
  await page.goto(linkIn(mail.text));
  await expect(page.getByText("¡Listo! Confirmaste tu email.")).toBeVisible();
  await page.getByRole("link", { name: "Ir a Cumplia" }).click();
}

// ---------- TOTP (RFC 6238), como la app del teléfono ----------

const base32Decode = (input: string) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of input.replace(/[\s=]/g, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
};

export function totp(secret: string, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

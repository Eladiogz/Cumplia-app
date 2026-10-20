/**
 * Capturas del manual de usuario (docs/manual/img). Recorre Cumplia como lo haría un
 * cliente nuevo, de cero: registro, seguridad, equipo, evaluación y riesgos.
 * Regenerarlas cuando cambie la interfaz: `pnpm manual:capturas`.
 */
import { mkdirSync } from "node:fs";
import { devices, type Locator, type Page } from "@playwright/test";
import { MAILPIT_URL } from "../env.js";
import { PASSWORD, expect, linkIn, test, totp, waitForEmail, type Account } from "../tests/support.js";

const IMG = new URL("../../../docs/manual/img/", import.meta.url).pathname;
mkdirSync(IMG, { recursive: true });

const ADMIN: Account = { name: "Ana Gómez", email: "ana.gomez@ejemplo.com.ar", organization: "Estudio Contable Sur" };
const CONSULTOR = { name: "Martín López", email: "martin.lopez@ejemplo.com.ar" };

/** Captura de la página o de un elemento, marcando opcionalmente lo que hay que tocar. */
async function shot(page: Page, name: string, opts: { area?: Locator; mark?: Locator | Locator[]; fullPage?: boolean } = {}) {
  const marks = opts.mark ? [opts.mark].flat() : [];
  for (const m of marks) {
    await m.evaluate((el) => {
      (el as HTMLElement).style.outline = "3px solid #e11d48";
      (el as HTMLElement).style.outlineOffset = "3px";
    });
  }
  await page.waitForTimeout(250);
  const path = `${IMG}${name}.png`;
  if (opts.area) await opts.area.screenshot({ path });
  else await page.screenshot({ path, fullPage: opts.fullPage ?? false });
  for (const m of marks) {
    await m.evaluate((el) => {
      (el as HTMLElement).style.outline = "";
      (el as HTMLElement).style.outlineOffset = "";
    });
  }
}

/** Mailpit muestra el email tal como lo recibe la persona. */
async function shotEmail(page: Page, to: string, subject: string, name: string) {
  const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  const { messages } = (await res.json()) as { messages: { ID: string; Subject: string }[] };
  const message = messages.find((m) => m.Subject.includes(subject));
  if (!message) throw new Error(`No llegó "${subject}" a ${to}`);
  const view = await page.context().newPage();
  await view.setViewportSize({ width: 760, height: 520 });
  await view.goto(`${MAILPIT_URL}/view/${message.ID}.html`);
  await view.screenshot({ path: `${IMG}${name}.png` });
  await view.close();
}

const card = (page: Page, title: string | RegExp) =>
  page.locator('[data-slot="card"]').filter({ has: page.getByRole("heading", { name: title }) }).first();

test("recorrido completo para el manual", async ({ page, browser, context }) => {
  /** Secreto de la app de autenticación (para el ingreso con código al final). */
  let secret = "";
  // Emails de corridas anteriores (mismas direcciones): fuera.
  for (const to of [ADMIN.email, CONSULTOR.email]) {
    await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`, { method: "DELETE" });
  }

  await test.step("1. Primeros pasos", async () => {
    await page.goto("/ingresar");
    await shot(page, "01-ingresar", { mark: page.getByRole("link", { name: "Registrá tu organización" }) });

    await page.goto("/registro");
    await page.getByLabel("Organización").fill(ADMIN.organization);
    await page.getByLabel("Tu nombre (opcional)").fill(ADMIN.name);
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Repetí la contraseña").fill(PASSWORD);
    await shot(page, "02-registro", { fullPage: true, mark: page.getByRole("button", { name: "Crear cuenta" }) });
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByRole("heading", { name: "Hola, Ana" })).toBeVisible();
    await shot(page, "03-inicio", { mark: page.getByText(/Confirmá tu email \(/) });

    const mail = await waitForEmail(ADMIN.email, "Confirmá tu email");
    await shotEmail(page, ADMIN.email, "Confirmá tu email", "04-email-confirmacion");
    await page.goto(linkIn(mail.text));
    await expect(page.getByText("¡Listo! Confirmaste tu email.")).toBeVisible();
    await shot(page, "05-email-confirmado");
    await page.getByRole("link", { name: "Ir a Cumplia" }).click();

    await page.getByRole("button", { name: "Menú de usuario" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await shot(page, "06-menu-usuario");
    await page.keyboard.press("Escape");
  });

  await test.step("2. Seguridad de la cuenta", async () => {
    await page.goto("/seguridad");
    await shot(page, "07-seguridad", { fullPage: true, mark: page.getByRole("button", { name: "Activar", exact: true }) });

    await page.getByRole("button", { name: "Activar", exact: true }).click();
    await expect(page.getByRole("img", { name: /Código QR/ })).toBeVisible();
    secret = (await page.locator("code").first().innerText()).replace(/\s/g, "");
    await page.getByLabel("Código", { exact: true }).fill(totp(secret));
    await shot(page, "08-mfa-qr", { area: card(page, /Verificación en dos pasos/), mark: page.getByRole("button", { name: "Confirmar y activar" }) });
    await page.getByRole("button", { name: "Confirmar y activar" }).click();
    await expect(page.getByText("Verificación en dos pasos activada")).toBeVisible();
    await shot(page, "09-mfa-codigos", { area: card(page, /Verificación en dos pasos activada/), mark: page.getByLabel("Los guardé en un lugar seguro") });
    await page.getByLabel("Los guardé en un lugar seguro").check();
    await page.getByRole("button", { name: "Listo" }).click();
    await expect(page.getByText("Activa", { exact: true })).toBeVisible();

    await shot(page, "10-sesiones", { area: card(page, /Sesiones activas/) });
  });

  await test.step("3. Organización y equipo", async () => {
    await page.goto("/organizacion");
    await shot(page, "11-organizacion", { fullPage: true });

    await page.getByLabel("Email", { exact: true }).fill(CONSULTOR.email);
    await page.getByLabel("Rol", { exact: true }).selectOption("CONSULTANT");
    await shot(page, "12-invitar", { area: card(page, "Invitaciones"), mark: page.getByRole("button", { name: "Invitar", exact: true }) });
    await page.getByRole("button", { name: "Invitar", exact: true }).click();
    await expect(page.getByText(`Enviamos la invitación a ${CONSULTOR.email}`)).toBeVisible();
    await shot(page, "13-invitacion-enviada", { area: card(page, "Invitaciones") });

    const mail = await waitForEmail(CONSULTOR.email, "Te invitaron");
    await shotEmail(page, CONSULTOR.email, "Te invitaron", "14-email-invitacion");

    const invitedContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "es-AR" });
    const invited = await invitedContext.newPage();
    await invited.goto(linkIn(mail.text));
    await invited.getByLabel("Tu nombre (opcional)").fill(CONSULTOR.name);
    await invited.getByLabel("Elegí una contraseña", { exact: true }).fill(PASSWORD);
    await invited.getByLabel("Repetí la contraseña").fill(PASSWORD);
    await shot(invited, "15-aceptar-invitacion", { fullPage: true, mark: invited.getByRole("button", { name: "Crear cuenta y unirme" }) });
    await invited.getByRole("button", { name: "Crear cuenta y unirme" }).click();
    await expect(invited.getByRole("heading", { name: "Hola, Martín" })).toBeVisible();
    await invitedContext.close();

    await page.reload();
    await shot(page, "16-miembros", { area: card(page, "Miembros") });
  });

  let assessmentId = "";
  await test.step("4. Evaluación ISO 27001", async () => {
    await page.goto("/evaluaciones");
    await shot(page, "17-evaluaciones", { mark: page.getByRole("button", { name: "Nueva evaluación" }) });
    await page.getByRole("button", { name: "Nueva evaluación" }).click();
    await page.getByLabel("Nombre").fill("Gap ISO 27001 2026");
    await shot(page, "18-nueva-evaluacion", { mark: page.getByRole("button", { name: "Crear y empezar" }) });
    await page.getByRole("button", { name: "Crear y empezar" }).click();
    await expect(page.getByRole("heading", { name: "Gap ISO 27001 2026" })).toBeVisible();
    assessmentId = page.url().split("/").pop()!.split("?")[0]!;
    await shot(page, "19-asistente");

    await page.getByRole("button", { name: /^A\.5\.1\s/ }).click();
    await page.getByRole("button", { name: "Sí, aplica" }).click();
    await page.getByRole("radio", { name: /^2/ }).click();
    await page.getByLabel("Notas (opcional)").fill("Política aprobada en 2024; falta la revisión anual y comunicarla a todo el personal.");
    await expect(page.getByRole("status").filter({ hasText: "Guardado" })).toBeVisible();
    await shot(page, "20-control-madurez", {
      area: page.locator("#control-A\\.5\\.1"),
      mark: page.getByRole("radio", { name: /^2/ }),
    });

    // Evidencia: un PDF (generado acá) y una nota con link.
    const pdfPage = await context.newPage();
    await pdfPage.setContent(
      "<h1>Política de seguridad de la información</h1><p>Versión 2.1 — aprobada por la dirección el 12/03/2026.</p>",
    );
    const pdf = await pdfPage.pdf({ format: "A4" });
    await pdfPage.close();
    await page.getByRole("tab", { name: "Archivo" }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: "politica-seguridad-v2.1.pdf", mimeType: "application/pdf", buffer: pdf });
    await page.getByLabel("Descripción del archivo (opcional)").fill("Política firmada por la dirección (v2.1)");
    await page.getByRole("button", { name: "Subir" }).click();
    await expect(page.getByText("Política firmada por la dirección (v2.1)")).toBeVisible();
    await page.getByRole("tab", { name: "Nota o link" }).click();
    await page.getByLabel("Nota o link de la evidencia").fill("Acta de aprobación — https://intranet.ejemplo.com.ar/actas/2026-03");
    await page.getByRole("button", { name: "Agregar" }).click();
    await expect(page.getByText(/Acta de aprobación/)).toBeVisible();
    await shot(page, "21-evidencia", { area: page.locator("#control-A\\.5\\.1") });

    await page.getByRole("button", { name: /^A\.5\.2\s/ }).click();
    await page.getByRole("button", { name: "No aplica" }).click();
    await shot(page, "22-no-aplica-falta-justificacion", { area: page.locator("#control-A\\.5\\.2") });
    await page.getByLabel("¿Por qué no aplica? (obligatorio)").fill("Los roles de seguridad los define el grupo empresario en su propia política.");
    await expect(page.getByRole("status").filter({ hasText: "Guardado" })).toBeVisible();

    // Resto de las respuestas por API (así el tablero muestra un caso real a medio camino).
    const fw = (await (await page.request.get("/api/frameworks/iso27001-2022")).json()) as { controls: { id: string }[] };
    const pattern = [2, 3, 1, 3, 4, 2, 0, 3, 2, 1, 3, 2];
    const answers = fw.controls
      .filter((c, i) => !["A.5.1", "A.5.2"].includes(c.id) && i % 3 !== 2)
      .map((c, i) =>
        ["A.7.1", "A.7.2", "A.7.6"].includes(c.id)
          ? { controlId: c.id, applicable: false, justification: "Trabajo 100% remoto: sin oficinas propias." }
          : { controlId: c.id, applicable: true, maturity: pattern[i % pattern.length] },
      );
    expect((await page.request.put(`/api/assessments/${assessmentId}/answers`, { data: { answers } })).ok()).toBe(true);

    await page.goto(`/evaluaciones/${assessmentId}/resultado`);
    await expect(page.getByRole("heading", { name: /Resultado/ })).toBeVisible();
    await shot(page, "23-resultado", { fullPage: true });
    await page.getByRole("button", { name: "Exportar SoA" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await shot(page, "24-exportar-soa");
    await page.keyboard.press("Escape");
  });

  await test.step("5. Registro de riesgos", async () => {
    await page.goto("/riesgos");
    await shot(page, "25-riesgos-vacio", { mark: page.getByRole("link", { name: "Nuevo riesgo" }) });

    await page.goto("/riesgos/nuevo");
    await page.getByLabel("Riesgo", { exact: true }).fill("Robo de credenciales por phishing al área de finanzas");
    await page.getByLabel("Activo afectado (opcional)").fill("Correo corporativo");
    await page.getByLabel("Amenaza o vulnerabilidad (opcional)").fill("Usuarios sin capacitación; MFA no obligatorio");
    await page.getByLabel("Probabilidad", { exact: true }).selectOption("4");
    await page.getByLabel("Impacto", { exact: true }).selectOption("4");
    await page.getByLabel("Plan de tratamiento (opcional)").fill("Capacitación trimestral y MFA obligatorio para toda la organización.");
    await page.getByLabel("Buscar control para agregar").fill("concientiz");
    await page.getByRole("button", { name: /A\.6\.3/ }).click();
    await page.getByLabel("Evaluar el riesgo residual").check();
    await page.getByLabel("Probabilidad residual").selectOption("2");
    await page.getByLabel("Impacto residual").selectOption("3");
    await page.getByLabel("Estado").selectOption("in_treatment");
    await page.getByLabel("Fecha límite (opcional)").fill("2026-12-15");
    await shot(page, "26-nuevo-riesgo", { fullPage: true, mark: page.getByRole("button", { name: "Registrar riesgo" }) });
    await page.getByRole("button", { name: "Registrar riesgo" }).click();
    await expect(page).toHaveURL(/\/riesgos$/);

    for (const data of [
      { title: "Ransomware en el servidor de archivos", asset: "Servidor de archivos", likelihood: 3, impact: 5, residualLikelihood: 2, residualImpact: 4, status: "in_treatment" },
      { title: "Caída del proveedor de nube contable", likelihood: 2, impact: 5, treatment: "transfer", treatmentPlan: "SLA y seguro de interrupción." },
      { title: "Fuga de datos de clientes por un ex empleado", likelihood: 2, impact: 4, controlIds: ["A.5.18", "A.6.5"] },
      { title: "Pérdida de notebook con información sin cifrar", likelihood: 3, impact: 3, residualLikelihood: 3, residualImpact: 1, status: "closed" },
      { title: "Phishing por WhatsApp a socios", likelihood: 5, impact: 4, dueDate: "2026-09-30" },
      { title: "Corte de energía en la oficina", likelihood: 2, impact: 2, treatment: "accept", treatmentPlan: "Trabajo remoto posible; aprobado por la dirección.", status: "accepted" },
    ]) {
      expect((await page.request.post("/api/risks", { data })).ok()).toBe(true);
    }
    await page.reload();
    await shot(page, "27-riesgos", { fullPage: true });

    await page.getByRole("button", { name: /Probabilidad 4 Probable, impacto 4 Mayor/ }).click();
    await shot(page, "28-riesgos-filtro-celda", { fullPage: true });
    await page.getByRole("button", { name: "Limpiar filtros" }).click();
    await page.getByRole("button", { name: "Residual", exact: true }).click();
    await shot(page, "29-riesgos-residual", { area: card(page, "Mapa de calor") });
  });

  await test.step("6. Tema, celular e ingreso con código", async () => {
    await page.getByRole("button", { name: "Menú de usuario" }).click();
    await page.getByRole("menuitemradio", { name: "Oscuro" }).click();
    await page.keyboard.press("Escape");
    await page.goto(`/evaluaciones/${assessmentId}/resultado`);
    await shot(page, "30-tema-oscuro");
    await page.getByRole("button", { name: "Menú de usuario" }).click();
    await page.getByRole("menuitemradio", { name: "Según el sistema" }).click();
    await page.keyboard.press("Escape");

    const mobile = await browser.newContext({ ...devices["Pixel 7"], storageState: await context.storageState(), locale: "es-AR" });
    const phone = await mobile.newPage();
    await phone.goto("/riesgos");
    await expect(phone.getByRole("heading", { name: "Riesgos" })).toBeVisible();
    await shot(phone, "31-celular");
    await mobile.close();

    await page.getByRole("button", { name: "Menú de usuario" }).click();
    await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(/\/ingresar\/verificacion/);
    await page.getByLabel("Código", { exact: true }).fill(totp(secret, Date.now() + 30_000));
    await shot(page, "32-ingreso-codigo", { mark: page.getByLabel("Código", { exact: true }) });
    await page.getByRole("button", { name: "Verificar" }).click();
    await expect(page.getByRole("heading", { name: "Hola, Ana" })).toBeVisible();

    await page.context().clearCookies();
    await page.goto("/olvide-contrasena");
    await page.getByLabel("Email de tu cuenta").fill(ADMIN.email);
    await shot(page, "33-olvide-contrasena", { mark: page.getByRole("button", { name: "Enviarme el link" }) });
  });
});

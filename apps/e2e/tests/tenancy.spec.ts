import { expect, linkIn, newAccount, PASSWORD, register, test, uniqueEmail, verifyEmail, waitForEmail } from "./support.js";

/**
 * Multi-tenant de punta a punta: cada organización en su propio navegador (contexto),
 * como dos clientes reales. Una no ve ni toca lo de la otra; una invitación da
 * acceso solo a la organización que invitó, con el rol elegido.
 */
test("una organización no ve los datos de otra; la invitación da acceso solo a la suya", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const orgA = newAccount("org-a");
  const orgB = newAccount("org-b");

  try {
    // A registra un riesgo.
    await register(a, orgA);
    await a.goto("/riesgos/nuevo");
    await a.getByLabel("Riesgo", { exact: true }).fill("Secreto de la organización A");
    await a.getByRole("button", { name: "Registrar riesgo" }).click();
    await a.getByRole("link", { name: "Secreto de la organización A" }).click();
    await expect(a).toHaveURL(/\/riesgos\/[0-9a-f-]{36}$/);
    const riskUrl = a.url();

    // B (otra organización) no lo ve en su lista ni abriendo el link directo.
    await register(b, orgB);
    await b.goto("/riesgos");
    await expect(b.getByText("Todavía no hay riesgos")).toBeVisible();
    await b.goto(riskUrl);
    await expect(b.getByText("Riesgo no encontrado")).toBeVisible();
    await expect(b.getByText("Secreto de la organización A")).toHaveCount(0);

    // A invita a una persona nueva como Auditor/a (invitar exige email confirmado).
    await verifyEmail(a, orgA.email);
    const invited = uniqueEmail("auditora");
    await a.goto("/organizacion");
    await a.getByLabel("Email", { exact: true }).fill(invited);
    await a.getByLabel("Rol", { exact: true }).selectOption("AUDITOR");
    await a.getByRole("button", { name: "Invitar", exact: true }).click();
    await expect(a.getByText(`Enviamos la invitación a ${invited}`)).toBeVisible();

    // La persona invitada crea su cuenta desde el link del email.
    const contextC = await browser.newContext();
    const c = await contextC.newPage();
    try {
      const mail = await waitForEmail(invited, "Te invitaron");
      await c.goto(linkIn(mail.text));
      await expect(c.getByText(`Te invitaron a ${orgA.organization}`)).toBeVisible();
      await c.getByLabel("Elegí una contraseña", { exact: true }).fill(PASSWORD);
      await c.getByLabel("Repetí la contraseña").fill(PASSWORD);
      await c.getByRole("button", { name: "Crear cuenta y unirme" }).click();
      await expect(c.getByText(`${orgA.organization} · Auditor/a`)).toBeVisible();

      // Ve los riesgos de A, en modo lectura.
      await c.goto("/riesgos");
      await expect(c.getByRole("link", { name: "Secreto de la organización A" })).toBeVisible();
      await expect(c.getByRole("link", { name: "Nuevo riesgo" })).toHaveCount(0);
      await c.goto(riskUrl);
      await expect(c.getByLabel("Riesgo", { exact: true })).toBeDisabled();

      // El link de invitación no sirve dos veces.
      await c.goto("/");
      await contextC.clearCookies();
      await c.goto(linkIn(mail.text));
      await expect(c.getByText("No se puede usar esta invitación")).toBeVisible();
    } finally {
      await contextC.close();
    }
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

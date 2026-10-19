import { expect, newAccount, register, test, verifyEmail } from "./support.js";

test("evaluación: responder controles, ver el resultado y exportar la SoA", async ({ page }) => {
  const account = newAccount("evaluacion");
  await register(page, account);
  await verifyEmail(page, account.email); // exportar exige email confirmado

  await page.goto("/evaluaciones");
  await page.getByRole("button", { name: "Nueva evaluación" }).click();
  await page.getByLabel("Nombre").fill("Gap E2E");
  await page.getByRole("button", { name: "Crear y empezar" }).click();
  await expect(page.getByRole("heading", { name: "Gap E2E" })).toBeVisible();

  // A.5.1: aplica, madurez 3 (alcanza el objetivo). Se guarda solo.
  await page.getByRole("button", { name: /^A\.5\.1\s/ }).click();
  await page.getByRole("button", { name: "Sí, aplica" }).click();
  await page.getByRole("radio", { name: /^3/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Guardado" })).toBeVisible();

  // A.5.2: no aplica → sin justificación no se guarda; con justificación, sí.
  await page.getByRole("button", { name: /^A\.5\.2\s/ }).click();
  await page.getByRole("button", { name: "No aplica" }).click();
  await expect(page.getByText("Falta la justificación para guardar")).toBeVisible();
  await page.getByLabel("¿Por qué no aplica? (obligatorio)").fill("Lo cubre el grupo empresario con su propia política.");
  await expect(page.getByRole("status").filter({ hasText: "Guardado" })).toBeVisible();

  // Lo guardado persiste al recargar.
  await page.reload();
  await expect(page.getByText(/2 de 93 controles resueltos/)).toBeVisible();

  await page.getByRole("link", { name: "Ver resultado" }).click();
  await expect(page.getByRole("heading", { name: /Resultado · Gap E2E/ })).toBeVisible();
  await expect(page.getByText(/evaluaste 1 de 92 controles aplicables/)).toBeVisible();

  await page.getByRole("button", { name: "Exportar SoA" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: /PDF/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^SoA - Gap E2E - \d{4}-\d{2}-\d{2}\.pdf$/);
  const pdf = await download.createReadStream();
  const first = await new Promise<Buffer>((resolve) => pdf.once("data", (c) => resolve(Buffer.from(c))));
  expect(first.subarray(0, 5).toString()).toBe("%PDF-");
});

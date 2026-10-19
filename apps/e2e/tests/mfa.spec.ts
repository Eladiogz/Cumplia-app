import { appAlert, expect, login, logout, newAccount, register, test, totp, waitForEmail } from "./support.js";

test("verificación en dos pasos: activar con la app y luego exigir el código al ingresar", async ({ page }) => {
  const account = newAccount("mfa");
  await register(page, account);

  await page.goto("/seguridad");
  await page.getByRole("button", { name: "Activar", exact: true }).click();
  await expect(page.getByRole("img", { name: /Código QR/ })).toBeVisible();
  // La clave manual (la misma del QR), como la cargaría alguien sin cámara.
  const secret = (await page.locator("code").first().innerText()).replace(/\s/g, "");
  await page.getByLabel("Código", { exact: true }).fill(totp(secret));
  await page.getByRole("button", { name: "Confirmar y activar" }).click();

  await expect(page.getByText("Verificación en dos pasos activada")).toBeVisible();
  await page.getByLabel("Los guardé en un lugar seguro").check();
  await page.getByRole("button", { name: "Listo" }).click();
  await expect(page.getByText("Activa", { exact: true })).toBeVisible();
  await waitForEmail(account.email, "Activaste la verificación en dos pasos");

  await logout(page);
  await login(page, account.email);
  await expect(page).toHaveURL(/\/ingresar\/verificacion/);

  await page.getByLabel("Código", { exact: true }).fill("000000");
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(appAlert(page)).toBeVisible();
  await expect(page).toHaveURL(/\/ingresar\/verificacion/);

  // Código del período siguiente: el del período actual ya se usó al activar.
  await page.getByLabel("Código", { exact: true }).fill(totp(secret, Date.now() + 30_000));
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(page.getByRole("heading", { name: "Hola, Ana" })).toBeVisible();
});

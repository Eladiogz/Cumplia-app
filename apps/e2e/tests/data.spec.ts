import { PASSWORD, appAlert, expect, login, newAccount, register, test, verifyEmail, waitForEmail } from "./support.js";

test.describe("derechos sobre los datos", () => {
  test("corregir el nombre, exportar todo y eliminar la organización (y la cuenta que queda sin uso)", async ({ page }) => {
    const account = newAccount("datos");
    await register(page, account);
    await verifyEmail(page, account.email);

    // Rectificación: el nombre propio.
    await page.goto("/seguridad");
    await page.getByLabel("Nombre y apellido").fill("Ana María Prueba");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(appAlert(page, "Guardamos tu nombre.")).toBeVisible();

    // Única persona de su organización: no puede borrar la cuenta y dejarla huérfana.
    await page.getByRole("button", { name: "Eliminar mi cuenta…" }).click();
    await page.getByLabel(/Escribí tu email/).fill(account.email);
    await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Eliminar mi cuenta para siempre" }).click();
    await expect(appAlert(page, /quedaría sin nadie/)).toBeVisible();

    // Portabilidad: todo en un ZIP.
    await page.goto("/organizacion");
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Descargar ZIP" }).click();
    expect((await download).suggestedFilename()).toMatch(/^Cumplia - .+ - \d{4}-\d{2}-\d{2}\.zip$/);

    // Supresión: la organización entera.
    await page.getByRole("button", { name: "Eliminar la organización…" }).click();
    const confirm = page.getByRole("button", { name: "Eliminar para siempre" });
    await page.getByLabel(/Escribí el nombre de la organización/).fill("otro nombre");
    await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
    await expect(confirm).toBeDisabled();
    await page.getByLabel(/Escribí el nombre de la organización/).fill(account.organization);
    await confirm.click();

    await expect(page).toHaveURL(/\/ingresar\?aviso=organizacion-eliminada/);
    await expect(appAlert(page, "Eliminamos la organización")).toBeVisible();
    const mail = await waitForEmail(account.email, "Se eliminó");
    expect(mail.text).toContain("también eliminamos tu cuenta");

    // Su cuenta no tenía otra organización: ya no existe.
    await login(page, account.email);
    await expect(appAlert(page, "Credenciales inválidas")).toBeVisible();
  });
});

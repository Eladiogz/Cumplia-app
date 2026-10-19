import { appAlert, expect, linkIn, login, logout, newAccount, register, test, verifyEmail, waitForEmail } from "./support.js";

test.describe("cuenta", () => {
  test("registro, confirmación del email por correo y cierre de sesión", async ({ page }) => {
    const account = newAccount("registro");
    await register(page, account);
    const banner = page.getByText(/Confirmá tu email \(/);
    await expect(banner).toBeVisible();

    await verifyEmail(page, account.email);
    await expect(page.getByRole("heading", { name: "Hola, Ana" })).toBeVisible();
    await expect(banner).toBeHidden();

    await logout(page);
    // Sin sesión, el área privada manda a ingresar (y vuelve después).
    await page.goto("/riesgos");
    await expect(page).toHaveURL(/\/ingresar\?siguiente=%2Friesgos/);
  });

  test("ingreso: con la contraseña equivocada no entra; con la correcta, sí", async ({ page }) => {
    const account = newAccount("ingreso");
    await register(page, account);
    await logout(page);

    await login(page, account.email, "Otra-Clave-Equivocada-99");
    await expect(appAlert(page, "Credenciales inválidas")).toBeVisible();
    await expect(page).toHaveURL(/\/ingresar/);

    await login(page, account.email);
    await expect(page.getByRole("heading", { name: "Hola, Ana" })).toBeVisible();
  });

  test("recuperar la contraseña con el link del email", async ({ page }) => {
    const account = newAccount("recuperar");
    await register(page, account);
    await logout(page);

    await page.getByRole("link", { name: "¿Olvidaste tu contraseña?" }).click();
    await page.getByLabel("Email de tu cuenta").fill(account.email);
    await page.getByRole("button", { name: "Enviarme el link" }).click();
    // Mismo mensaje exista o no la cuenta: no revela qué emails están registrados.
    await expect(appAlert(page, "Si hay una cuenta con ese")).toBeVisible();

    const mail = await waitForEmail(account.email, "Restablecé tu contraseña");
    await page.goto(linkIn(mail.text));
    const nueva = "Otra-Clave-Mas-Segura-2027";
    await page.getByLabel("Contraseña nueva", { exact: true }).fill(nueva);
    await page.getByLabel("Repetí la contraseña").fill(nueva);
    await page.getByRole("button", { name: "Guardar contraseña" }).click();
    await expect(page.getByText("Listo: tu contraseña cambió")).toBeVisible();

    // El mismo link no sirve dos veces (antes se sale de la página: si solo cambia el #, no recarga).
    await page.goto("/ingresar");
    await page.goto(linkIn(mail.text));
    await page.getByLabel("Contraseña nueva", { exact: true }).fill("Tercera-Clave-Distinta-2028");
    await page.getByLabel("Repetí la contraseña").fill("Tercera-Clave-Distinta-2028");
    await page.getByRole("button", { name: "Guardar contraseña" }).click();
    await expect(page.getByText(/venció|no es válido|ya se usó/)).toBeVisible();

    await login(page, account.email, nueva);
    await expect(page.getByRole("heading", { name: "Hola, Ana" })).toBeVisible();
  });
});

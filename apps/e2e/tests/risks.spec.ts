import { expect, newAccount, register, test } from "./support.js";

test("riesgos: registrar con nivel en vivo, aceptar con justificación y filtrar desde el mapa", async ({ page }) => {
  await register(page, newAccount("riesgos"));

  await page.goto("/riesgos");
  await page.getByRole("link", { name: "Registrar un riesgo" }).click();
  await page.getByLabel("Riesgo", { exact: true }).fill("Phishing a socios por WhatsApp");
  await page.getByLabel("Activo afectado (opcional)").fill("Cuentas bancarias");
  await page.getByLabel("Probabilidad", { exact: true }).selectOption("4");
  await page.getByLabel("Impacto", { exact: true }).selectOption("5");
  await expect(page.getByText(/^Crítico\s*\(20\)$/)).toBeVisible();

  // Controles del Anexo A con el buscador.
  await page.getByLabel("Buscar control para agregar").fill("concientiz");
  await page.getByRole("button", { name: /A\.6\.3/ }).click();
  await expect(page.getByRole("button", { name: "Quitar A.6.3" })).toBeVisible();

  // Aceptar sin justificación: no se puede registrar.
  await page.getByRole("radio", { name: /Aceptar/ }).check();
  await page.getByLabel("Estado").selectOption("accepted");
  await page.getByRole("button", { name: "Registrar riesgo" }).click();
  await expect(page).toHaveURL(/\/riesgos\/nuevo/);

  await page.getByLabel("Justificación de la aceptación").fill("Costo del control mayor al impacto. Aprobado por la dirección.");
  await page.getByRole("button", { name: "Registrar riesgo" }).click();
  await expect(page).toHaveURL(/\/riesgos$/);

  const row = page.getByRole("row", { name: /R-001/ });
  await expect(row).toContainText("Phishing a socios por WhatsApp");
  await expect(row).toContainText("Crítico");
  await expect(row).toContainText("Aceptado");

  // Mapa de calor: la celda P4 × I5 tiene el riesgo; elegirla filtra la lista.
  const cell = page.getByRole("button", { name: /Probabilidad 4 Probable, impacto 5 Catastrófico: .* 1 riesgo$/ });
  await cell.click();
  await expect(page.getByText("1 de 1 riesgo")).toBeVisible();
  await page.getByRole("button", { name: /Probabilidad 1 Rara, impacto 1/ }).click();
  await expect(page.getByText("Ningún riesgo coincide con los filtros.")).toBeVisible();

  // Editar: bajar la probabilidad cambia el nivel.
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await page.getByRole("link", { name: "Phishing a socios por WhatsApp" }).click();
  await page.getByLabel("Probabilidad", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Cambios guardados.")).toBeVisible();
  await expect(page.getByText(/^Alto\s*\(10\)$/)).toBeVisible();
});

import { expect, newAccount, register, test } from "./support.js";

test("tema: oscuro desde el menú, se recuerda al recargar y vuelve al del sistema", async ({ page }) => {
  await register(page, newAccount("tema"));
  const html = page.locator("html");

  await page.getByRole("button", { name: "Menú de usuario" }).click();
  await page.getByRole("menuitemradio", { name: "Oscuro" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: "Menú de usuario" }).click();
  await page.getByRole("menuitemradio", { name: "Según el sistema" }).click();
  await expect(html).not.toHaveAttribute("data-theme", /.+/);
});

// Página SIN el guardián de CSP: acá la violación es justamente lo que se espera.
test("cada página lleva su CSP con nonce y un script inyectado no corre", async ({ context }) => {
  const page = await context.newPage();
  const violations: string[] = [];
  await page.exposeFunction("reportViolation", (d: string) => violations.push(d));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) =>
      (window as unknown as { reportViolation: (d: string) => void }).reportViolation(e.violatedDirective),
    );
  });

  const response = await page.goto("/ingresar");
  const csp = response!.headers()["content-security-policy"]!;
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'(;|$)/);
  expect(csp).not.toContain("unsafe-inline' 'strict");
  const nonce = csp.match(/'nonce-([^']+)'/)![1]!;
  const second = (await page.request.get("/ingresar")).headers()["content-security-policy"];
  expect(second).not.toContain(nonce); // nonce nuevo en cada respuesta

  // Lo que dejaría un XSS: HTML con un manejador en línea. El navegador lo bloquea.
  await page.evaluate(() => {
    const div = document.createElement("div");
    div.innerHTML = '<img src="/no-existe.png" onerror="window.__xss = 1">';
    document.body.appendChild(div);
  });
  await expect.poll(() => violations).toContain("script-src-attr");
  expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
});

test("@celular navegación y mapa de riesgos en pantalla chica, sin desborde", async ({ page }) => {
  await register(page, newAccount("celular"));
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Riesgos" }).click();
  await expect(page.getByRole("heading", { name: "Riesgos" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});

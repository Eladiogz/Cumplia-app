import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests de la lógica de la web (sin navegador): cliente de la API, navegación segura, etc.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});

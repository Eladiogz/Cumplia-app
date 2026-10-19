/**
 * Tema de la interfaz. La elección se guarda en una cookie (no es un dato sensible)
 * para que el servidor ya pinte la página con el tema correcto: sin parpadeo y sin
 * scripts en línea antes del pintado. Sin cookie se sigue al sistema operativo.
 */
export type Theme = "system" | "light" | "dark";

export const THEME_COOKIE = "cumplia_theme";

export const THEME_LABEL: Record<Theme, string> = {
  system: "Según el sistema",
  light: "Claro",
  dark: "Oscuro",
};

/** Valor de la cookie → tema explícito; cualquier otra cosa = seguir al sistema. */
export function parseTheme(value: string | undefined | null): "light" | "dark" | null {
  return value === "light" || value === "dark" ? value : null;
}

/** Cookie a escribir para el tema (vacía y vencida para volver al del sistema). */
export function themeCookie(theme: Theme): string {
  const base = `${THEME_COOKIE}=${theme === "system" ? "" : theme}; Path=/; SameSite=Lax`;
  return theme === "system" ? `${base}; Max-Age=0` : `${base}; Max-Age=${60 * 60 * 24 * 365}`;
}

/** Aplica el tema al instante en el navegador y lo recuerda. */
export function applyTheme(theme: Theme) {
  document.cookie = themeCookie(theme);
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

/** Tema elegido actualmente (según el atributo que puso el servidor o la última elección). */
export function currentTheme(): Theme {
  return parseTheme(document.documentElement.getAttribute("data-theme")) ?? "system";
}

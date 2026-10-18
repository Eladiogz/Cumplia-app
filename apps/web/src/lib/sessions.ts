/** Sesión abierta de la cuenta, tal como la devuelve GET /auth/sessions. */
export interface ActiveSession {
  id: string;
  organizationId: string;
  organizationName: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export interface DeviceInfo {
  browser: string;
  os: string;
  mobile: boolean;
}

// El orden importa: Edge y Opera también dicen "Chrome"; Chrome también dice "Safari".
const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

/** "Chrome en Windows" a partir del user-agent (aproximado: lo informa el navegador). */
export function describeUserAgent(ua: string | null): DeviceInfo {
  if (!ua) return { browser: "Navegador desconocido", os: "", mobile: false };
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? "Otro navegador";
  const os = SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? "";
  return { browser, os, mobile: /Mobile|iPhone|Android/.test(ua) };
}

export const deviceLabel = (d: DeviceInfo) => (d.os ? `${d.browser} en ${d.os}` : d.browser);

/** "ahora", "hace 5 minutos", "hace 2 horas", "hace 3 días". */
export function timeAgo(iso: string, now = new Date()) {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} minuto${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} hora${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `hace ${days} día${days === 1 ? "" : "s"}`;
}

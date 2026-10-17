import type { NextConfig } from "next";

// La web y la API comparten origen: el navegador habla con /api/* y Next lo reenvía
// a la API. Así la cookie de sesión (httpOnly, SameSite) funciona sin CORS.
// API_URL se lee al compilar (las rewrites quedan en el manifiesto) y al arrancar.
const apiUrl = (process.env.API_URL ?? "http://localhost:3000").replace(/\/$/, "");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // El token de invitación va en el fragmento (#), que nunca viaja en el Referer; igual no se envía.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Evidencia de hasta 10 MB + el "sobre" multipart: el valor por defecto (10 MB) la cortaría.
    // El límite real lo aplica la API.
    proxyClientMaxBodySize: "12mb",
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;

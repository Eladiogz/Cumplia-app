import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, newNonce } from "@/lib/csp";

/**
 * Antes de cada página: nonce nuevo y CSP. Next.js lee el nonce de la cabecera
 * Content-Security-Policy de la petición y lo pone en sus propios <script>.
 */
export function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV === "development" });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // /api/* lo responde la API con su propia CSP; los estáticos no la necesitan.
      source: "/((?!api/|_next/static|_next/image|favicon.ico).*)",
      // Las precargas de next/link no renderizan HTML: no hace falta nonce.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

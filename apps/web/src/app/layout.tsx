import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { CspNonce } from "@/components/csp-nonce";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Cumplia", template: "%s · Cumplia" },
  description: "Cumplimiento sin planillas: ISO 27001 para pymes y consultores de LATAM.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Cada página se arma por petición: así lleva el nonce de la CSP (ver src/proxy.ts).
  // Una página prerenderizada tendría scripts sin nonce y el navegador los bloquearía.
  await connection();
  const nonce = (await headers()).get("x-nonce");
  return (
    <html lang="es">
      <body>
        <CspNonce nonce={nonce} />
        {children}
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Cumplia", template: "%s · Cumplia" },
  description: "Cumplimiento sin planillas: ISO 27001 para pymes y consultores de LATAM.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

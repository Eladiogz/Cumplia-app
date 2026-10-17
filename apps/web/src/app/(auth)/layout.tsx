import type { ReactNode } from "react";
import { Logo } from "@/components/logo";

/** Pantallas de acceso: una tarjeta centrada, sin menú. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted/50 p-4">
      <Logo className="text-xl" />
      <div className="w-full max-w-md">{children}</div>
      <p className="text-xs text-muted-foreground">Cumplimiento sin planillas · ISO/IEC 27001</p>
    </div>
  );
}

"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { FullPageSpinner } from "@/components/form";
import { Button } from "@/components/ui/button";
import { loginUrl } from "@/lib/navigation";
import { SessionProvider, useSession } from "@/lib/session";

/**
 * Área autenticada. La API es la que protege los datos; este guardia solo evita
 * mostrar pantallas vacías: sin sesión → ingresar; con MFA exigido y no activado → Seguridad.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <Guard>{children}</Guard>
    </SessionProvider>
  );
}

function Guard({ children }: { children: ReactNode }) {
  const { state, refresh } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const mustSetUpMfa = state.status === "authenticated" && state.me.mfaSetupRequired && pathname !== "/seguridad";

  useEffect(() => {
    if (state.status === "anonymous") router.replace(loginUrl(pathname));
    else if (mustSetUpMfa) router.replace("/seguridad");
  }, [state.status, mustSetUpMfa, pathname, router]);

  if (state.status === "error") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-4 text-center">
        <p className="text-sm text-muted-foreground">{state.message}</p>
        <Button variant="outline" onClick={() => void refresh()}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (state.status !== "authenticated" || mustSetUpMfa) return <FullPageSpinner />;
  return <AppShell>{children}</AppShell>;
}

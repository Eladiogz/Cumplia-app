"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Building2, Check, ChevronsUpDown, ClipboardList, Home, LogOut, MailWarning, ShieldCheck, ShieldAlert } from "lucide-react";
import { Logo } from "@/components/logo";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, errorMessage } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/roles";
import { logout, switchOrganization, useMe } from "@/lib/session";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/evaluaciones", label: "Evaluaciones", icon: ClipboardList },
  { href: "/organizacion", label: "Organización", icon: Building2 },
  { href: "/seguridad", label: "Seguridad", icon: ShieldCheck },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { me } = useMe();
  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-60 shrink-0 border-r bg-card md:flex md:flex-col">
        <div className="flex h-14 items-center border-b px-5">
          <Logo />
        </div>
        <Nav className="flex-col p-3" />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b bg-card px-4 md:px-6">
          <Logo className="md:hidden" />
          <div className="ml-auto flex items-center gap-2">
            <OrganizationSwitcher />
            <UserMenu />
          </div>
        </header>
        <Nav className="overflow-x-auto border-b bg-card px-2 py-1 md:hidden" />
        <main className="mx-auto w-full max-w-5xl flex-1 p-4 md:p-8">
          {!me.emailVerified && <VerifyEmailBanner email={me.user.email} />}
          {me.mfaSetupRequired && (
            <Alert variant="warning" className="mb-6">
              <ShieldAlert aria-hidden />
              <AlertDescription>
                Tu organización exige la verificación en dos pasos. Activala para seguir usando Cumplia.
              </AlertDescription>
            </Alert>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

/** Aviso mientras el email no está confirmado, con reenvío del link. */
function VerifyEmailBanner({ email }: { email: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const resend = async () => {
    setPending(true);
    try {
      const res = await api<{ message: string }>("/auth/email/verification", { method: "POST" });
      setMessage(res.message);
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <Alert className="mb-6">
      <MailWarning aria-hidden />
      <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          Confirmá tu email ({email}) con el link que te enviamos. Hasta entonces no podés invitar a otras personas.
        </span>
        {message ? (
          <span className="font-medium">{message}</span>
        ) : (
          <Button size="sm" variant="link" className="h-auto p-0" disabled={pending} onClick={() => void resend()}>
            Reenviar el link
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

function Nav({ className }: { className?: string }) {
  const pathname = usePathname();
  const { me } = useMe();
  return (
    <nav className={cn("flex gap-1", className)} aria-label="Principal">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        // Mientras falte activar MFA exigido, solo se puede ir a Seguridad.
        const blocked = me.mfaSetupRequired && href !== "/seguridad";
        if (blocked) {
          return (
            <span
              key={href}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground/60"
              aria-disabled="true"
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </span>
          );
        }
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent",
              active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function OrganizationSwitcher() {
  const { organizations } = useMe();
  const [error, setError] = useState<string | null>(null);
  const active = organizations.find((o) => o.active);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-56" aria-label="Cambiar de organización">
          <Building2 aria-hidden />
          <span className="truncate">{active?.organizationName ?? "Organización"}</span>
          <ChevronsUpDown className="opacity-50" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Tus organizaciones</DropdownMenuLabel>
        {organizations.map((o) => (
          <DropdownMenuItem
            key={o.organizationId}
            disabled={o.active}
            onSelect={() => switchOrganization(o.organizationId).catch((e: unknown) => setError(errorMessage(e)))}
          >
            <Check className={cn(!o.active && "invisible")} aria-hidden />
            <span className="flex-1 truncate">{o.organizationName}</span>
            <span className="text-xs text-muted-foreground">{ROLE_LABEL[o.role]}</span>
          </DropdownMenuItem>
        ))}
        {error && <p className="px-2 py-1.5 text-xs text-destructive">{error}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { me } = useMe();
  const initials = (me.user.name ?? me.user.email).slice(0, 2).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full bg-secondary" aria-label="Menú de usuario">
          <span className="text-xs font-semibold">{initials}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="grid gap-0.5">
          <span className="truncate text-sm font-medium text-foreground">{me.user.name ?? me.user.email}</span>
          {me.user.name && <span className="truncate">{me.user.email}</span>}
          <span>{ROLE_LABEL[me.role]}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/seguridad">
            <ShieldCheck aria-hidden /> Seguridad
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut aria-hidden /> Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

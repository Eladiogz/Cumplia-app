"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { MailCheck } from "lucide-react";
import { Field, FormError, Spinner } from "@/components/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, api, errorMessage } from "@/lib/api";
import { loginUrl, tokenFromHash } from "@/lib/navigation";
import { passwordProblem } from "@/lib/password";
import { ROLE_LABEL } from "@/lib/roles";
import { logout } from "@/lib/session";
import type { InvitationPreview, Me } from "@/lib/types";

type State =
  | { step: "loading" }
  | { step: "invalid"; message: string }
  | { step: "ready"; token: string; invitation: InvitationPreview; me: Me | null };

export default function AcceptInvitationPage() {
  const [state, setState] = useState<State>({ step: "loading" });

  useEffect(() => {
    // El token viene en el fragmento (#): nunca llegó a ningún servidor.
    const token = tokenFromHash(window.location.hash);
    if (!token) {
      setState({ step: "invalid", message: "El link de invitación está incompleto. Abrilo de nuevo desde el email." });
      return;
    }
    void (async () => {
      try {
        const invitation = await api<InvitationPreview>("/auth/invitations/preview", { body: { token } });
        const me = await api<Me>("/auth/me").catch(() => null);
        setState({ step: "ready", token, invitation, me });
      } catch (err) {
        setState({ step: "invalid", message: errorMessage(err) });
      }
    })();
  }, []);

  if (state.step === "loading") {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <Spinner label="Revisando la invitación…" />
        </CardContent>
      </Card>
    );
  }

  if (state.step === "invalid") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">No se puede usar esta invitación</CardTitle>
          <CardDescription>{state.message}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Pedile a quien te invitó que te envíe una nueva. Las invitaciones vencen a los 7 días y sirven una sola vez.
        </CardContent>
      </Card>
    );
  }

  const { token, invitation, me } = state;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Te invitaron a {invitation.organizationName}</CardTitle>
        <CardDescription>
          Rol: <strong className="text-foreground">{ROLE_LABEL[invitation.role]}</strong> · para {invitation.email}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {me ? <JoinAsCurrentUser token={token} invitation={invitation} me={me} /> : <CreateAccount token={token} invitation={invitation} />}
      </CardContent>
    </Card>
  );
}

/** Ya hay sesión: la cuenta se une (si el email coincide) y pasa a la nueva organización. */
function JoinAsCurrentUser({ token, invitation, me }: { token: string; invitation: InvitationPreview; me: Me }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (me.user.email !== invitation.email) {
    return (
      <div className="grid gap-4">
        <Alert variant="warning">
          <AlertDescription>
            Estás con la cuenta {me.user.email}, pero la invitación es para {invitation.email}. Cerrá sesión e ingresá con
            esa cuenta (o creala).
          </AlertDescription>
        </Alert>
        <Button
          variant="outline"
          onClick={() => {
            // Al volver, el link sigue disponible.
            const back = `/invitaciones/aceptar#token=${encodeURIComponent(token)}`;
            void api("/auth/logout", { method: "POST" }).finally(() => window.location.assign(back));
          }}
        >
          Cerrar sesión y continuar
        </Button>
      </div>
    );
  }

  const join = async () => {
    setPending(true);
    setError(null);
    try {
      await api("/auth/invitations/accept", { body: { token } });
      window.location.assign("/");
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <div className="grid gap-4">
      <FormError message={error} />
      <p className="text-sm text-muted-foreground">
        Vas a sumar {invitation.organizationName} a tus organizaciones y pasar a trabajar en ella. Podés cambiar de
        organización cuando quieras desde el menú superior.
      </p>
      <Button onClick={() => void join()} disabled={pending}>
        {pending ? "Uniéndote…" : `Unirme a ${invitation.organizationName}`}
      </Button>
      <Button variant="link" onClick={() => void logout()}>
        No soy {me.user.email}
      </Button>
    </div>
  );
}

/** Sin sesión: crea la cuenta con el email de la invitación (o, si ya existe, manda a ingresar). */
function CreateAccount({ token, invitation }: { token: string; invitation: InvitationPreview }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [accountExists, setAccountExists] = useState(false);
  const [pending, setPending] = useState(false);
  const backHere = loginUrl(`/invitaciones/aceptar#token=${encodeURIComponent(token)}`);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password, confirm, invitation.email);
    if (problem) return setError(problem);
    setError(null);
    setPending(true);
    try {
      await api("/auth/invitations/accept", {
        body: { token, password, ...(name.trim() ? { name: name.trim() } : {}) },
      });
      window.location.assign("/");
    } catch (err) {
      setPending(false);
      if (err instanceof ApiError && err.status === 409) setAccountExists(true);
      else setError(errorMessage(err));
    }
  };

  if (accountExists) {
    return (
      <div className="grid gap-4">
        <Alert>
          <MailCheck aria-hidden />
          <AlertDescription>Ya existe una cuenta con {invitation.email}. Ingresá y vas a volver acá para aceptar.</AlertDescription>
        </Alert>
        <Button asChild>
          <Link href={backHere}>Ingresar</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <FormError message={error} />
      <Field id="email" label="Email">
        <Input id="email" value={invitation.email} disabled readOnly />
      </Field>
      <Field id="name" label="Tu nombre (opcional)">
        <Input id="name" autoComplete="name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id="password" label="Elegí una contraseña" hint="Mínimo 12 caracteres.">
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          aria-describedby="password-hint"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Field id="confirm" label="Repetí la contraseña">
        <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Creando tu cuenta…" : "Crear cuenta y unirme"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        ¿Ya tenés cuenta con este email?{" "}
        <Link href={backHere} className="font-medium text-primary hover:underline">
          Ingresá
        </Link>
      </p>
    </form>
  );
}

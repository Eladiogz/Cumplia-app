"use client";

import { useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { KeyRound, ShieldCheck, ShieldOff, Trash2, UserRound } from "lucide-react";
import { ActiveSessions } from "@/components/active-sessions";
import { Field, FormError, FormSuccess } from "@/components/form";
import { PageHeader } from "@/components/page-header";
import { NewPasswordField } from "@/components/password-field";
import { CodeInput, ReauthFields, reauthReady, type Reauth } from "@/components/reauth-fields";
import { RecoveryCodes } from "@/components/recovery-codes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { passwordProblem } from "@/lib/password";
import { useMe } from "@/lib/session";

export default function SecurityPage() {
  const { me } = useMe();
  return (
    <>
      <PageHeader
        title="Seguridad"
        description="Tus datos, tu contraseña, la verificación en dos pasos (MFA) y dónde está abierta tu cuenta."
      />
      <div className="grid gap-4">
        {me.mfaEnabled ? <MfaEnabled /> : <MfaSetup />}
        {!me.mfaSetupRequired && (
          <>
            <Profile />
            <ChangePassword />
          </>
        )}
        <ActiveSessions />
        {!me.mfaSetupRequired && <DeleteAccount />}
      </div>
    </>
  );
}

/** Corregir el nombre propio. El email identifica la cuenta: no se cambia desde acá. */
function Profile() {
  const { me, refresh } = useMe();
  const [name, setName] = useState(me.user.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setPending(true);
    try {
      await api("/auth/me", { method: "PATCH", body: { name: name.trim() } });
      setSuccess("Guardamos tu nombre.");
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRound className="size-4 text-primary" aria-hidden /> Tus datos
        </CardTitle>
        <CardDescription>Tu nombre aparece para los demás miembros y en las invitaciones que envíes.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid max-w-md gap-4">
          <FormError message={error} />
          <FormSuccess message={success} />
          <Field id="profile-email" label="Email">
            <Input id="profile-email" type="email" value={me.user.email} disabled readOnly />
          </Field>
          <Field id="profile-name" label="Nombre y apellido">
            <Input
              id="profile-name"
              autoComplete="name"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div>
            <Button type="submit" variant="outline" disabled={pending || !name.trim() || name.trim() === (me.user.name ?? "")}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Eliminar la propia cuenta (irreversible). La API no lo permite si la persona es el
 * único ADMIN de alguna organización y explica qué hacer antes.
 */
function DeleteAccount() {
  const { me } = useMe();
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [reauth, setReauth] = useState<Reauth>({ password: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api("/auth/account/delete", { body: { confirmEmail: confirmEmail.trim().toLowerCase(), ...reauth } });
      window.location.assign("/ingresar?aviso=cuenta-eliminada");
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trash2 className="size-4 text-destructive" aria-hidden /> Eliminar tu cuenta
        </CardTitle>
        <CardDescription>
          Borra tus datos personales, tus sesiones y tu acceso a todas tus organizaciones. No se puede deshacer. Lo que
          cargaste en cada organización (evaluaciones, evidencia, riesgos) es de la organización y queda; su registro de
          auditoría conserva tus acciones.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!open ? (
          <Button variant="outline" className="text-destructive" onClick={() => setOpen(true)}>
            Eliminar mi cuenta…
          </Button>
        ) : (
          <form onSubmit={submit} className="grid max-w-md gap-4">
            <FormError message={error} />
            <p className="text-sm text-muted-foreground">
              Si sos el único administrador de una organización, antes nombrá a otra persona como administradora o eliminá
              la organización (desde Organización, donde también podés exportar sus datos).
            </p>
            <Field id="delete-account-email" label={`Escribí tu email (${me.user.email}) para confirmar`}>
              <Input
                id="delete-account-email"
                type="email"
                autoComplete="off"
                required
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
              />
            </Field>
            <ReauthFields idPrefix="delete-account" mfaEnabled={me.mfaEnabled} value={reauth} onChange={setReauth} />
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="destructive"
                disabled={
                  pending || confirmEmail.trim().toLowerCase() !== me.user.email || !reauthReady(reauth, me.mfaEnabled)
                }
              >
                {pending ? "Eliminando…" : "Eliminar mi cuenta para siempre"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function ChangePassword() {
  const { me, organizations } = useMe();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const context = {
    email: me.user.email,
    name: me.user.name,
    organizationName: organizations.map((o) => o.organizationName).join(" "),
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSuccess(null);
    const problem = passwordProblem(password, confirm, context);
    if (problem) return setError(problem);
    setError(null);
    setPending(true);
    try {
      await api("/auth/password", { body: { currentPassword: current, newPassword: password } });
      setSuccess("Listo: cambiaste tu contraseña y cerramos tus otras sesiones.");
      setCurrent("");
      setPassword("");
      setConfirm("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4 text-primary" aria-hidden /> Contraseña
        </CardTitle>
        <CardDescription>Al cambiarla cerramos tus sesiones en otros dispositivos.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid max-w-md gap-4">
          <FormError message={error} />
          <FormSuccess message={success} />
          <Field id="current-password" label="Contraseña actual">
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <NewPasswordField id="new-password" label="Contraseña nueva" value={password} onChange={setPassword} context={context} />
          <Field id="confirm-password" label="Repetí la contraseña nueva">
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Cambiar contraseña"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Activación: 1) escanear el QR, 2) confirmar con un código, 3) guardar los códigos de recuperación. */
function MfaSetup() {
  const { refresh } = useMe();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const start = async () => {
    setError(null);
    setPending(true);
    try {
      const res = await api<{ secret: string; otpauthUri: string }>("/auth/mfa/setup", { method: "POST" });
      // El QR se genera en el navegador: el secreto no pasa por ningún servicio externo.
      const qr = await QRCode.toDataURL(res.otpauthUri, { margin: 1, width: 200 });
      setSetup({ secret: res.secret, qr });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await api<{ recoveryCodes: string[] }>("/auth/mfa/enable", { body: { code } });
      setRecoveryCodes(res.recoveryCodes);
    } catch (err) {
      setError(errorMessage(err));
      setCode("");
    } finally {
      setPending(false);
    }
  };

  if (recoveryCodes) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-success" aria-hidden /> Verificación en dos pasos activada
          </CardTitle>
          <CardDescription>Cerramos tus otras sesiones abiertas por seguridad.</CardDescription>
        </CardHeader>
        <CardContent>
          <RecoveryCodes codes={recoveryCodes} onDone={() => void refresh()} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Verificación en dos pasos <Badge variant="warning">Desactivada</Badge>
        </CardTitle>
        <CardDescription>
          Además de la contraseña, vas a ingresar un código que genera tu teléfono (Google Authenticator, Microsoft
          Authenticator, 1Password u otra app compatible).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <FormError message={error} />
        {!setup ? (
          <div>
            <Button onClick={() => void start()} disabled={pending}>
              {pending ? "Preparando…" : "Activar"}
            </Button>
          </div>
        ) : (
          <form onSubmit={confirm} className="grid gap-6 md:grid-cols-[auto_1fr]">
            <div className="grid justify-items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL generada en el navegador */}
              <img src={setup.qr} alt="Código QR para tu app de autenticación" width={200} height={200} className="rounded-md border" />
            </div>
            <div className="grid content-start gap-4">
              <ol className="grid list-decimal gap-2 pl-5 text-sm">
                <li>Abrí tu app de autenticación y escaneá el código QR.</li>
                <li>
                  ¿No podés escanear? Ingresá esta clave a mano:{" "}
                  <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {setup.secret.match(/.{1,4}/g)?.join(" ")}
                  </code>
                </li>
                <li>Escribí el código de 6 dígitos que muestra la app.</li>
              </ol>
              <Field id="code" label="Código">
                <CodeInput id="code" value={code} onChange={setCode} />
              </Field>
              <div>
                <Button type="submit" disabled={pending || code.length !== 6}>
                  {pending ? "Verificando…" : "Confirmar y activar"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function MfaEnabled() {
  const { organizations } = useMe();
  const requiredBy = organizations.filter((o) => o.requireMfa).map((o) => o.organizationName);
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-success" aria-hidden /> Verificación en dos pasos{" "}
            <Badge variant="success">Activa</Badge>
          </CardTitle>
          <CardDescription>Cada vez que ingreses te vamos a pedir un código de tu app.</CardDescription>
        </CardHeader>
      </Card>
      <RegenerateCodes />
      <DisableMfa requiredBy={requiredBy} />
    </>
  );
}

function RegenerateCodes() {
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await api<{ recoveryCodes: string[] }>("/auth/mfa/recovery-codes", { body: { code } });
      setCodes(res.recoveryCodes);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
      setCode("");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Códigos de recuperación</CardTitle>
        <CardDescription>Si te quedan pocos o creés que alguien los vio, generá nuevos: los anteriores dejan de servir.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {codes ? (
          <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />
        ) : (
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
            <FormError message={error} />
            <Field id="regen-code" label="Código de tu app">
              <CodeInput id="regen-code" value={code} onChange={setCode} />
            </Field>
            <Button type="submit" variant="outline" disabled={pending || code.length !== 6}>
              Generar códigos nuevos
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function DisableMfa({ requiredBy }: { requiredBy: string[] }) {
  const { refresh } = useMe();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (requiredBy.length > 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldOff className="size-4 text-muted-foreground" aria-hidden /> Desactivar
          </CardTitle>
          <CardDescription>No se puede desactivar: lo exige {requiredBy.join(", ")}.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api("/auth/mfa/disable", { body: { password, code } });
      await refresh(); // la página pasa a mostrar "Desactivada"
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldOff className="size-4 text-muted-foreground" aria-hidden /> Desactivar
        </CardTitle>
        <CardDescription>Tu cuenta va a depender solo de la contraseña. Te pedimos ambas cosas para confirmar que sos vos.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!open ? (
          <div>
            <Button variant="outline" onClick={() => setOpen(true)}>
              Desactivar verificación en dos pasos
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="grid max-w-sm gap-4">
            <FormError message={error} />
            <Field id="disable-password" label="Contraseña">
              <Input
                id="disable-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field id="disable-code" label="Código de tu app">
              <CodeInput id="disable-code" value={code} onChange={setCode} />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" disabled={pending || code.length !== 6}>
                {pending ? "Desactivando…" : "Desactivar"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

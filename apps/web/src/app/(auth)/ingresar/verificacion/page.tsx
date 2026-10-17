"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Field, FormError } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, api, errorMessage } from "@/lib/api";
import { loginUrl, safeNext } from "@/lib/navigation";
import type { SessionStart } from "@/lib/types";

function VerifyForm() {
  const next = safeNext(useSearchParams().get("siguiente"));
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const body = useRecovery ? { recoveryCode: value.trim() } : { code: value.replace(/\s/g, "") };
      const res = await api<SessionStart>("/auth/mfa/verify", { body });
      // Pocos códigos de recuperación: directo a generar nuevos.
      const lowOnCodes = res.recoveryCodesRemaining !== undefined && res.recoveryCodesRemaining <= 3;
      window.location.assign(lowOnCodes ? "/seguridad" : next);
    } catch (err) {
      setPending(false);
      setValue("");
      // Sin desafío vigente (venció o se agotaron los intentos): hay que reingresar la contraseña.
      if (err instanceof ApiError && err.status === 401 && err.message.includes("venció")) setExpired(true);
      setError(errorMessage(err));
    }
  };

  if (expired) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">El ingreso venció</CardTitle>
          <CardDescription>Pasaron más de 5 minutos o hubo demasiados intentos.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href={loginUrl(next)}>Volver a ingresar</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Verificación en dos pasos</CardTitle>
        <CardDescription>
          {useRecovery
            ? "Ingresá uno de tus códigos de recuperación (sirve una sola vez)."
            : "Ingresá el código de 6 dígitos de tu app de autenticación."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          <FormError message={error} />
          {useRecovery ? (
            <Field id="recovery" label="Código de recuperación">
              <Input id="recovery" autoComplete="off" placeholder="xxxxx-xxxxx" required value={value} onChange={(e) => setValue(e.target.value)} />
            </Field>
          ) : (
            <Field id="code" label="Código">
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                placeholder="123456"
                required
                autoFocus
                className="text-center font-mono text-lg tracking-[0.4em]"
                value={value}
                onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Verificando…" : "Verificar"}
          </Button>
          <Button
            type="button"
            variant="link"
            onClick={() => {
              setUseRecovery(!useRecovery);
              setValue("");
              setError(null);
            }}
          >
            {useRecovery ? "Usar el código de la app" : "No tengo el teléfono: usar un código de recuperación"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyForm />
    </Suspense>
  );
}

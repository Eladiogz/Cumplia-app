"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { Field, FormError } from "@/components/form";
import { NewPasswordField } from "@/components/password-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { tokenFromHash } from "@/lib/navigation";
import { passwordProblem } from "@/lib/password";

export default function ResetPasswordPage() {
  // undefined = leyendo el link; null = link incompleto.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => setToken(tokenFromHash(window.location.hash)), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    // Email y organización los conoce la API, que aplica la regla de datos personales.
    const problem = passwordProblem(password, confirm, {});
    if (problem) return setError(problem);
    setError(null);
    setPending(true);
    try {
      await api("/auth/password/reset", { body: { token, newPassword: password } });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  if (token === undefined) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Elegí una contraseña nueva</CardTitle>
        <CardDescription>Al guardarla cerramos todas tus sesiones abiertas.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!token ? (
          <>
            <FormError message="El link está incompleto. Abrilo de nuevo desde el email o pedí uno nuevo." />
            <Button asChild variant="outline">
              <Link href="/olvide-contrasena">Pedir un link nuevo</Link>
            </Button>
          </>
        ) : done ? (
          <>
            <Alert variant="success">
              <CheckCircle2 aria-hidden />
              <AlertDescription>Listo: tu contraseña cambió. Ingresá con la nueva.</AlertDescription>
            </Alert>
            <Button asChild>
              <Link href="/ingresar">Ingresar</Link>
            </Button>
          </>
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <FormError message={error} />
            <NewPasswordField id="password" label="Contraseña nueva" value={password} onChange={setPassword} context={{}} />
            <Field id="confirm" label="Repetí la contraseña">
              <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Guardar contraseña"}
            </Button>
            {error?.includes("venció") && (
              <Link href="/olvide-contrasena" className="text-center text-sm text-primary hover:underline">
                Pedir un link nuevo
              </Link>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}

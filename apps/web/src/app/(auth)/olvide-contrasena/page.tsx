"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { MailCheck } from "lucide-react";
import { Field, FormError } from "@/components/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await api<{ message: string }>("/auth/password/forgot", { body: { email } });
      setSent(res.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">¿Olvidaste tu contraseña?</CardTitle>
        <CardDescription>Te enviamos un link para elegir una nueva. Vence en 30 minutos.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {sent ? (
          <Alert variant="success">
            <MailCheck aria-hidden />
            <AlertDescription>
              <p>{sent}</p>
              <p>Revisá también la carpeta de spam.</p>
            </AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <FormError message={error} />
            <Field id="email" label="Email de tu cuenta">
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Button type="submit" disabled={pending}>
              {pending ? "Enviando…" : "Enviarme el link"}
            </Button>
          </form>
        )}
        <Link href="/ingresar" className="text-center text-sm text-primary hover:underline">
          Volver a ingresar
        </Link>
      </CardContent>
    </Card>
  );
}

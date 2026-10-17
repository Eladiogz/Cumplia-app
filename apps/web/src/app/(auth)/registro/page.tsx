"use client";

import Link from "next/link";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { Field, FormError } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { passwordProblem } from "@/lib/password";

export default function RegisterPage() {
  const [form, setForm] = useState({ name: "", email: "", organizationName: "", password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (key: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(form.password, form.confirm, form.email);
    if (problem) return setError(problem);
    setError(null);
    setPending(true);
    try {
      await api("/auth/register", {
        body: {
          email: form.email,
          password: form.password,
          organizationName: form.organizationName,
          ...(form.name.trim() ? { name: form.name.trim() } : {}),
        },
      });
      window.location.assign("/");
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Registrá tu organización</CardTitle>
        <CardDescription>Vas a ser el administrador/a; después podés invitar a tu equipo.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          <FormError message={error} />
          <Field id="organizationName" label="Organización">
            <Input id="organizationName" required minLength={2} maxLength={120} value={form.organizationName} onChange={set("organizationName")} />
          </Field>
          <Field id="name" label="Tu nombre (opcional)">
            <Input id="name" autoComplete="name" maxLength={100} value={form.name} onChange={set("name")} />
          </Field>
          <Field id="email" label="Email">
            <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={set("email")} />
          </Field>
          <Field id="password" label="Contraseña" hint="Mínimo 12 caracteres. Una frase larga es más segura y fácil de recordar.">
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              aria-describedby="password-hint"
              value={form.password}
              onChange={set("password")}
            />
          </Field>
          <Field id="confirm" label="Repetí la contraseña">
            <Input id="confirm" type="password" autoComplete="new-password" required value={form.confirm} onChange={set("confirm")} />
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Creando…" : "Crear cuenta"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            ¿Ya tenés cuenta?{" "}
            <Link href="/ingresar" className="font-medium text-primary hover:underline">
              Ingresá
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { FormError, Spinner } from "@/components/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, errorMessage } from "@/lib/api";
import { tokenFromHash } from "@/lib/navigation";

type State = { step: "verifying" } | { step: "done" } | { step: "error"; message: string };

export default function VerifyEmailPage() {
  const [state, setState] = useState<State>({ step: "verifying" });
  // El link sirve una sola vez: que el doble efecto de React (modo estricto) no lo gaste dos veces.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = tokenFromHash(window.location.hash);
    if (!token) {
      setState({ step: "error", message: "El link está incompleto. Abrilo de nuevo desde el email." });
      return;
    }
    api("/auth/email/verify", { body: { token } })
      .then(() => setState({ step: "done" }))
      .catch((e: unknown) => setState({ step: "error", message: errorMessage(e) }));
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Confirmación de email</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {state.step === "verifying" && <Spinner label="Confirmando…" />}
        {state.step === "done" && (
          <Alert variant="success">
            <CheckCircle2 aria-hidden />
            <AlertDescription>¡Listo! Confirmaste tu email.</AlertDescription>
          </Alert>
        )}
        {state.step === "error" && (
          <>
            <FormError message={state.message} />
            <p className="text-sm text-muted-foreground">Podés pedir un link nuevo desde el aviso que aparece al ingresar.</p>
          </>
        )}
        <Button asChild variant={state.step === "done" ? "default" : "outline"}>
          <Link href="/">Ir a Cumplia</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

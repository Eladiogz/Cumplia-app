"use client";

import { useState } from "react";
import { Copy, Download, KeyRound } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Muestra los códigos de recuperación UNA vez, con copiar/descargar y confirmación de guardado. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const asText = `Códigos de recuperación de Cumplia (cada uno sirve una sola vez)\n\n${codes.join("\n")}\n`;

  const copy = async () => {
    await navigator.clipboard.writeText(asText);
    setCopied(true);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([asText], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "cumplia-codigos-de-recuperacion.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-4">
      <Alert variant="warning">
        <KeyRound aria-hidden />
        <AlertTitle>Guardá estos códigos ahora</AlertTitle>
        <AlertDescription>
          Te permiten entrar si perdés el teléfono. No los vas a volver a ver; cada uno sirve una sola vez.
        </AlertDescription>
      </Alert>
      <ul className="grid grid-cols-2 gap-2 rounded-md border bg-muted p-4 font-mono text-sm" aria-label="Códigos de recuperación">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void copy()}>
          <Copy aria-hidden /> {copied ? "Copiados" : "Copiar"}
        </Button>
        <Button type="button" variant="outline" onClick={download}>
          <Download aria-hidden /> Descargar .txt
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-4" />
        Los guardé en un lugar seguro
      </label>
      <div>
        <Button type="button" disabled={!saved} onClick={onDone}>
          Listo
        </Button>
      </div>
    </div>
  );
}

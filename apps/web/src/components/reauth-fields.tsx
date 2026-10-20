"use client";

import { useState } from "react";
import { Field } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Código de 6 dígitos de la app de autenticación. */
export function CodeInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <Input
      id={id}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="\d{6}"
      maxLength={6}
      placeholder="123456"
      required
      className="max-w-40 text-center font-mono tracking-[0.3em]"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
    />
  );
}

export interface Reauth {
  password: string;
  code?: string;
  recoveryCode?: string;
}

/** ¿Están completos los datos para confirmar la identidad? */
export const reauthReady = (r: Reauth, mfaEnabled: boolean) =>
  r.password.length > 0 && (!mfaEnabled || r.code?.length === 6 || (r.recoveryCode?.trim().length ?? 0) >= 10);

/**
 * Contraseña y, con MFA, el código de la app (o uno de recuperación). Lo piden las
 * acciones irreversibles: una sesión abierta en otra computadora no alcanza.
 */
export function ReauthFields({
  idPrefix,
  mfaEnabled,
  value,
  onChange,
}: {
  idPrefix: string;
  mfaEnabled: boolean;
  value: Reauth;
  onChange: (v: Reauth) => void;
}) {
  const [useRecovery, setUseRecovery] = useState(false);
  return (
    <>
      <Field id={`${idPrefix}-password`} label="Contraseña">
        <Input
          id={`${idPrefix}-password`}
          type="password"
          autoComplete="current-password"
          required
          value={value.password}
          onChange={(e) => onChange({ ...value, password: e.target.value })}
        />
      </Field>
      {mfaEnabled && (
        <div className="grid gap-1">
          {useRecovery ? (
            <Field id={`${idPrefix}-recovery`} label="Código de recuperación">
              <Input
                id={`${idPrefix}-recovery`}
                autoComplete="off"
                required
                className="max-w-56 font-mono"
                value={value.recoveryCode ?? ""}
                onChange={(e) => onChange({ password: value.password, recoveryCode: e.target.value })}
              />
            </Field>
          ) : (
            <Field id={`${idPrefix}-code`} label="Código de tu app">
              <CodeInput id={`${idPrefix}-code`} value={value.code ?? ""} onChange={(code) => onChange({ password: value.password, code })} />
            </Field>
          )}
          <div>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={() => {
                setUseRecovery(!useRecovery);
                onChange({ password: value.password });
              }}
            >
              {useRecovery ? "Usar el código de la app" : "¿No tenés el teléfono? Usá un código de recuperación"}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

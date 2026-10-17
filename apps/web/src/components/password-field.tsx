"use client";

import { useId, useState } from "react";
import { Check, Eye, EyeOff, X } from "lucide-react";
import {
  CHECKLIST_RULES,
  PASSWORD_RULES,
  STRENGTH_LABELS,
  checkPassword,
  passwordStrength,
  type PasswordContext,
} from "@cumplia/core/password";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const BAR_COLORS = ["bg-destructive", "bg-destructive", "bg-warning", "bg-success", "bg-success"];

/**
 * Contraseña nueva con medidor de fortaleza y lista de requisitos que se marcan
 * mientras se escribe. Las reglas son las mismas que aplica la API.
 */
export function NewPasswordField({
  id,
  label = "Contraseña",
  value,
  onChange,
  context,
}: {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  context: PasswordContext;
}) {
  const [visible, setVisible] = useState(false);
  const hintId = useId();
  const failed = checkPassword(value, context);
  const strength = passwordStrength(value, context);
  const extra = failed.filter((r) => r === "tooLong" || r === "repeated" || r === "personal" || r === "common");

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          required
          maxLength={128}
          aria-describedby={hintId}
          aria-invalid={value.length > 0 && failed.length > 0}
          className="pr-10"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        >
          {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>

      <div id={hintId} className="grid gap-2">
        {value.length > 0 && (
          <div className="grid gap-1" aria-live="polite">
            <div className="flex gap-1" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={cn("h-1 flex-1 rounded-full bg-muted", i < strength && BAR_COLORS[strength])} />
              ))}
            </div>
            <span className="text-xs text-muted-foreground">Fortaleza: {STRENGTH_LABELS[strength]}</span>
          </div>
        )}
        <ul className="grid gap-0.5 text-xs sm:grid-cols-2">
          {CHECKLIST_RULES.map((rule) => {
            const ok = value.length > 0 && !failed.includes(rule);
            return (
              <li key={rule} className={cn("flex items-center gap-1.5", ok ? "text-success" : "text-muted-foreground")}>
                {ok ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5 opacity-50" aria-hidden />}
                {PASSWORD_RULES[rule]}
                <span className="sr-only">{ok ? "(cumplido)" : "(pendiente)"}</span>
              </li>
            );
          })}
        </ul>
        {value.length > 0 &&
          extra.map((rule) => (
            <p key={rule} className="text-xs text-destructive">
              {PASSWORD_RULES[rule]}.
            </p>
          ))}
        <p className="text-xs text-muted-foreground">
          Consejo: una frase de varias palabras con números y signos es más segura y fácil de recordar.
        </p>
      </div>
    </div>
  );
}

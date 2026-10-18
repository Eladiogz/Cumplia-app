"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Plus, Search, X } from "lucide-react";
import {
  IMPACT_LEVELS,
  LIKELIHOOD_LEVELS,
  RISK_STATUSES,
  RISK_STATUS_LABEL,
  RISK_TREATMENTS,
  RISK_TREATMENT_DESCRIPTION,
  RISK_TREATMENT_LABEL,
  riskLevel,
  riskProblem,
  riskScore,
  type RiskStatus,
  type RiskTreatment,
} from "@cumplia/core/risk";
import { Field, FormError, FormSuccess } from "@/components/form";
import { RiskLevelBadge } from "@/components/risk-level";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Control, Risk, RiskOwner } from "@/lib/types";

export interface RiskPayload {
  title: string;
  description: string | null;
  asset: string | null;
  threat: string | null;
  likelihood: number;
  impact: number;
  treatment: RiskTreatment;
  treatmentPlan: string | null;
  controlIds: string[];
  residualLikelihood: number | null;
  residualImpact: number | null;
  status: RiskStatus;
  ownerId: string | null;
  dueDate: string | null;
}

const blank = (s: string) => (s.trim() === "" ? null : s.trim());

/**
 * Alta y edición de un riesgo. La API valida todo; acá se avisa antes lo mismo
 * (reglas compartidas en @cumplia/core/risk) y se muestra el nivel en vivo.
 */
export function RiskForm({
  initial,
  owners,
  controls,
  readOnly = false,
  submitLabel,
  onSubmit,
  footer,
}: {
  initial?: Risk;
  owners: RiskOwner[];
  controls: Control[];
  readOnly?: boolean;
  submitLabel: string;
  onSubmit: (payload: RiskPayload) => Promise<void>;
  footer?: ReactNode;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [asset, setAsset] = useState(initial?.asset ?? "");
  const [threat, setThreat] = useState(initial?.threat ?? "");
  const [likelihood, setLikelihood] = useState(initial?.likelihood ?? 3);
  const [impact, setImpact] = useState(initial?.impact ?? 3);
  const [treatment, setTreatment] = useState<RiskTreatment>(initial?.treatment ?? "mitigate");
  const [treatmentPlan, setTreatmentPlan] = useState(initial?.treatmentPlan ?? "");
  const [controlIds, setControlIds] = useState<string[]>(initial?.controlIds ?? []);
  const [withResidual, setWithResidual] = useState(initial?.residualLikelihood != null);
  const [residualLikelihood, setResidualLikelihood] = useState(initial?.residualLikelihood ?? 2);
  const [residualImpact, setResidualImpact] = useState(initial?.residualImpact ?? 2);
  const [status, setStatus] = useState<RiskStatus>(initial?.status ?? "identified");
  const [ownerId, setOwnerId] = useState(initial?.ownerId ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const score = riskScore(likelihood, impact);
  const residualScore = riskScore(residualLikelihood, residualImpact);
  const problem = riskProblem({ treatment, treatmentPlan, status });
  const accepting = treatment === "accept";

  // El responsable actual puede no estar en la lista (ya no es miembro, o quien mira no edita).
  const ownerOptions = useMemo(() => {
    if (!initial?.ownerId || owners.some((o) => o.userId === initial.ownerId)) return owners;
    return [{ userId: initial.ownerId, name: initial.ownerName, email: initial.ownerEmail ?? "" }, ...owners];
  }, [owners, initial]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (problem) return setError(problem);
    setError(null);
    setSaved(null);
    setPending(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: blank(description),
        asset: blank(asset),
        threat: blank(threat),
        likelihood,
        impact,
        treatment,
        treatmentPlan: blank(treatmentPlan),
        controlIds,
        residualLikelihood: withResidual ? residualLikelihood : null,
        residualImpact: withResidual ? residualImpact : null,
        status,
        ownerId: ownerId || null,
        dueDate: dueDate || null,
      });
      if (initial) setSaved("Cambios guardados.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ocurrió un error inesperado.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <fieldset disabled={readOnly || pending} className="grid min-w-0 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Identificación</CardTitle>
            <CardDescription>Qué puede pasar, sobre qué activo y por qué.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field id="title" label="Riesgo">
              <Input
                id="title"
                required
                maxLength={200}
                placeholder="Ej.: Robo de credenciales por phishing al área de finanzas"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field id="asset" label="Activo afectado (opcional)">
                <Input id="asset" maxLength={200} placeholder="Ej.: Correo corporativo" value={asset} onChange={(e) => setAsset(e.target.value)} />
              </Field>
              <Field id="threat" label="Amenaza o vulnerabilidad (opcional)">
                <Input
                  id="threat"
                  maxLength={1000}
                  placeholder="Ej.: Usuarios sin capacitación, sin MFA"
                  value={threat}
                  onChange={(e) => setThreat(e.target.value)}
                />
              </Field>
            </div>
            <Field id="description" label="Descripción (opcional)">
              <Textarea id="description" maxLength={4000} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1.5">
              <CardTitle>Evaluación</CardTitle>
              <CardDescription>Riesgo inherente: sin contar el tratamiento. Puntaje = probabilidad × impacto.</CardDescription>
            </div>
            <div className="rounded-md border px-3 py-1.5" aria-live="polite">
              <span className="sr-only">Nivel inherente: </span>
              <RiskLevelBadge level={riskLevel(score)} score={score} className="text-sm" />
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <LevelSelect id="likelihood" label="Probabilidad" levels={LIKELIHOOD_LEVELS} value={likelihood} onChange={setLikelihood} />
            <LevelSelect id="impact" label="Impacto" levels={IMPACT_LEVELS} value={impact} onChange={setImpact} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tratamiento</CardTitle>
            <CardDescription>Qué decide la organización y con qué controles del Anexo A lo trata.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Tratamiento">
              {RISK_TREATMENTS.map((t) => (
                <label
                  key={t}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                    treatment === t ? "border-primary bg-accent" : "hover:bg-accent/50",
                  )}
                >
                  <input
                    type="radio"
                    name="treatment"
                    value={t}
                    checked={treatment === t}
                    onChange={() => setTreatment(t)}
                    className="mt-0.5 accent-[var(--primary)]"
                  />
                  <span className="grid gap-0.5">
                    <span className="font-medium">{RISK_TREATMENT_LABEL[t]}</span>
                    <span className="text-xs text-muted-foreground">{RISK_TREATMENT_DESCRIPTION[t]}</span>
                  </span>
                </label>
              ))}
            </div>
            <Field
              id="treatmentPlan"
              label={accepting ? "Justificación de la aceptación" : "Plan de tratamiento (opcional)"}
              hint={accepting ? "Obligatoria: por qué se asume el riesgo y quién lo aprobó." : "Acciones, plazos y recursos."}
            >
              <Textarea
                id="treatmentPlan"
                aria-describedby="treatmentPlan-hint"
                required={accepting}
                maxLength={4000}
                rows={3}
                value={treatmentPlan}
                onChange={(e) => setTreatmentPlan(e.target.value)}
              />
            </Field>
            <ControlPicker controls={controls} value={controlIds} onChange={setControlIds} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1.5">
              <CardTitle>Riesgo residual</CardTitle>
              <CardDescription>Cómo queda el riesgo después del tratamiento.</CardDescription>
            </div>
            {withResidual && (
              <div className="rounded-md border px-3 py-1.5" aria-live="polite">
                <span className="sr-only">Nivel residual: </span>
                <RiskLevelBadge level={riskLevel(residualScore)} score={residualScore} className="text-sm" />
              </div>
            )}
          </CardHeader>
          <CardContent className="grid gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={withResidual} onChange={(e) => setWithResidual(e.target.checked)} className="accent-[var(--primary)]" />
              Evaluar el riesgo residual
            </label>
            {withResidual && (
              <div className="grid gap-4 md:grid-cols-2">
                <LevelSelect
                  id="residualLikelihood"
                  label="Probabilidad residual"
                  levels={LIKELIHOOD_LEVELS}
                  value={residualLikelihood}
                  onChange={setResidualLikelihood}
                />
                <LevelSelect id="residualImpact" label="Impacto residual" levels={IMPACT_LEVELS} value={residualImpact} onChange={setResidualImpact} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Seguimiento</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <Field
              id="status"
              label="Estado"
              hint={status === "accepted" && !accepting ? "«Aceptado» requiere el tratamiento «Aceptar»." : undefined}
            >
              <NativeSelect
                id="status"
                aria-describedby="status-hint"
                aria-invalid={status === "accepted" && !accepting}
                value={status}
                onChange={(e) => setStatus(e.target.value as RiskStatus)}
              >
                {RISK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {RISK_STATUS_LABEL[s]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="owner" label="Responsable">
              <NativeSelect id="owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">Sin asignar</option>
                {ownerOptions.map((o) => (
                  <option key={o.userId} value={o.userId}>
                    {o.name ? `${o.name} (${o.email})` : o.email}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="dueDate" label="Fecha límite (opcional)">
              <Input id="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </CardContent>
        </Card>
      </fieldset>

      <FormError message={error} />
      <FormSuccess message={saved} />
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending || !title.trim()}>
            {pending ? "Guardando…" : submitLabel}
          </Button>
          {footer}
        </div>
      )}
      {readOnly && footer}
    </form>
  );
}

function LevelSelect({
  id,
  label,
  levels,
  value,
  onChange,
}: {
  id: string;
  label: string;
  levels: readonly { value: number; label: string; description: string }[];
  value: number;
  onChange: (v: number) => void;
}) {
  const current = levels.find((l) => l.value === value);
  return (
    <Field id={id} label={label} hint={current?.description}>
      <NativeSelect id={id} aria-describedby={`${id}-hint`} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {levels.map((l) => (
          <option key={l.value} value={l.value}>
            {l.value} · {l.label}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Controles del Anexo A: los elegidos como chips y un buscador para agregar. */
function ControlPicker({ controls, value, onChange }: { controls: Control[]; value: string[]; onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState("");
  const byId = useMemo(() => new Map(controls.map((c) => [c.id, c])), [controls]);
  const q = normalize(query.trim());
  const matches = q
    ? controls.filter((c) => !value.includes(c.id) && (normalize(c.id).includes(q) || normalize(c.title).includes(q))).slice(0, 8)
    : [];
  const add = (id: string) => {
    onChange([...value, id].sort((a, b) => a.localeCompare(b, "en", { numeric: true })));
    setQuery("");
  };

  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium" id="controls-label">
        Controles del Anexo A que lo tratan (opcional)
      </span>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-labelledby="controls-label">
          {value.map((id) => (
            <li key={id} className="inline-flex max-w-full items-center gap-1 rounded-md border bg-secondary py-0.5 pr-0.5 pl-2 text-xs">
              <span className="font-medium">{id}</span>
              <span className="truncate text-muted-foreground">{byId.get(id)?.title}</span>
              <button
                type="button"
                className="rounded p-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Quitar ${id}`}
                onClick={() => onChange(value.filter((x) => x !== id))}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          className="pl-9"
          placeholder="Buscar control por código o nombre (ej.: A.8.7 o malware)"
          aria-label="Buscar control para agregar"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches[0]) {
              e.preventDefault();
              add(matches[0].id);
            }
          }}
        />
      </div>
      {q && (
        <ul className="grid gap-1 rounded-md border p-1" aria-label="Resultados">
          {matches.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">Sin resultados.</li>
          ) : (
            matches.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => add(c.id)}
                >
                  <Plus className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span>
                    <span className="font-medium">{c.id}</span> {c.title}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

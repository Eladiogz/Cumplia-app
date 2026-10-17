"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertCircle, ArrowLeft, Check, ChevronDown, CircleDashed, FileText, Loader2, Pencil, SkipForward } from "lucide-react";
import { MATURITY_LEVELS } from "@cumplia/core/maturity";
import { Field, FormError, Spinner } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { answerProblem, isResolved, nextPending, percent, progressByDomain, statusOf } from "@/lib/assessment";
import { canEditAssessments } from "@/lib/roles";
import { useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { Answer, Assessment, Control, Evidence, Framework } from "@/lib/types";

type SaveState = "saving" | "saved" | "error" | "invalid";

export default function AssessmentWizardPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useMe();
  const readOnly = !canEditAssessments(me.role);

  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [framework, setFramework] = useState<Framework | null>(null);
  const [answers, setAnswers] = useState<Map<string, Answer>>(new Map());
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  // Controles que ya existen en el servidor (la evidencia se cuelga de una respuesta guardada).
  const [stored, setStored] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [domain, setDomain] = useState<string>("");
  const [onlyPending, setOnlyPending] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const a = await api<Assessment>(`/assessments/${id}`);
        const [fw, list, ev] = await Promise.all([
          api<Framework>(`/frameworks/${a.frameworkId}`),
          api<Answer[]>(`/assessments/${id}/answers`),
          api<Evidence[]>(`/assessments/${id}/evidence`),
        ]);
        setAssessment(a);
        setFramework(fw);
        setAnswers(new Map(list.map((x) => [x.controlId, x])));
        setStored(new Set(list.map((x) => x.controlId)));
        setEvidence(ev);
        const firstPending = nextPending(fw.controls, new Map(list.map((x) => [x.controlId, x])), null);
        setDomain(firstPending?.domain ?? Object.keys(fw.domains)[0] ?? "");
      } catch (e) {
        setLoadError(errorMessage(e));
      }
    })();
  }, [id]);

  // ---- Guardado automático: una fila por control, para que nunca gane una respuesta vieja ----
  const queues = useRef(new Map<string, Promise<void>>());
  const timers = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; answer: Answer }>());

  const persist = useCallback(
    (answer: Answer) => {
      const controlId = answer.controlId;
      if (answerProblem(answer)) {
        setSaveState((s) => ({ ...s, [controlId]: "invalid" }));
        return;
      }
      setSaveState((s) => ({ ...s, [controlId]: "saving" }));
      const body: Answer = {
        controlId,
        applicable: answer.applicable,
        ...(answer.applicable && answer.maturity !== undefined && answer.maturity !== null ? { maturity: answer.maturity } : {}),
        ...(answer.justification?.trim() ? { justification: answer.justification } : {}),
      };
      const run = async () => {
        try {
          await api(`/assessments/${id}/answers`, { method: "PUT", body: { answers: [body] } });
          setStored((s) => new Set(s).add(controlId));
          setSaveState((s) => ({ ...s, [controlId]: "saved" }));
        } catch {
          setSaveState((s) => ({ ...s, [controlId]: "error" }));
        }
      };
      const next = (queues.current.get(controlId) ?? Promise.resolve()).then(run);
      queues.current.set(controlId, next);
    },
    [id],
  );

  const update = useCallback(
    (answer: Answer, { debounce = false } = {}) => {
      setAnswers((prev) => new Map(prev).set(answer.controlId, answer));
      const pending = timers.current.get(answer.controlId);
      if (pending) clearTimeout(pending.timer);
      timers.current.delete(answer.controlId);
      if (debounce) {
        setSaveState((s) => ({ ...s, [answer.controlId]: "saving" }));
        const timer = setTimeout(() => {
          timers.current.delete(answer.controlId);
          persist(answer);
        }, 700);
        timers.current.set(answer.controlId, { timer, answer });
      } else {
        persist(answer);
      }
    },
    [persist],
  );

  // Al salir de la página, lo que estaba esperando la pausa de tipeo se guarda igual.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const { timer, answer } of pending.values()) {
        clearTimeout(timer);
        persist(answer);
      }
    };
  }, [persist]);

  const domainControls = useMemo(
    () =>
      framework?.controls.filter(
        // El control abierto sigue visible aunque se resuelva mientras se lo edita.
        (c) => c.domain === domain && (!onlyPending || c.id === openId || !isResolved(answers.get(c.id))),
      ) ?? [],
    [framework, domain, onlyPending, answers, openId],
  );

  const goToNextPending = (fromId: string | null) => {
    if (!framework) return;
    const next = nextPending(framework.controls, answers, fromId);
    if (!next) {
      setOpenId(null);
      return;
    }
    setDomain(next.domain);
    setOpenId(next.id);
    requestAnimationFrame(() => document.getElementById(`control-${next.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  if (loadError) {
    return (
      <div className="grid gap-4">
        <FormError message={loadError} />
        <Button asChild variant="outline" className="w-fit">
          <Link href="/evaluaciones">
            <ArrowLeft aria-hidden /> Volver a evaluaciones
          </Link>
        </Button>
      </div>
    );
  }
  if (!assessment || !framework) return <Spinner />;

  const totalResolved = framework.controls.filter((c) => isResolved(answers.get(c.id))).length;
  const domains = progressByDomain(framework, answers);
  const done = totalResolved === framework.controls.length;

  return (
    <div className="grid gap-6">
      <AssessmentHeader assessment={assessment} onChange={setAssessment} readOnly={readOnly} />

      <Card>
        <CardContent className="grid gap-3 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              <strong>{totalResolved}</strong> de {framework.controls.length} controles resueltos ({percent(totalResolved, framework.controls.length)}%)
            </span>
            {!readOnly && !done && (
              <Button size="sm" variant="outline" onClick={() => goToNextPending(openId)}>
                <SkipForward aria-hidden /> Ir al siguiente pendiente
              </Button>
            )}
            {done && <Badge variant="success">¡Evaluación completa!</Badge>}
          </div>
          <Progress value={percent(totalResolved, framework.controls.length)} label="Avance de la evaluación" />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
        <nav aria-label="Dominios" className="flex gap-2 overflow-x-auto lg:flex-col">
          {domains.map((d) => (
            <button
              key={d.domain}
              type="button"
              onClick={() => {
                setDomain(d.domain);
                setOpenId(null);
              }}
              aria-current={d.domain === domain ? "true" : undefined}
              className={cn(
                "grid min-w-44 gap-1.5 rounded-md border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                d.domain === domain && "border-primary/50 bg-accent",
              )}
            >
              <span className="flex items-center justify-between gap-2 font-medium">
                {d.label}
                {d.resolved === d.total && <Check className="size-4 text-success" aria-label="completo" />}
              </span>
              <span className="text-xs text-muted-foreground">
                {d.resolved}/{d.total}
              </span>
              <Progress value={percent(d.resolved, d.total)} label={`Avance de ${d.label}`} className="h-1" />
            </button>
          ))}
        </nav>

        <section aria-label={framework.domains[domain]} className="grid content-start gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{framework.domains[domain]}</h2>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" className="size-4" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
              Solo pendientes
            </label>
          </div>
          {domainControls.length === 0 && (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No quedan controles pendientes en este dominio.
            </p>
          )}
          {domainControls.map((control) => (
            <ControlItem
              key={control.id}
              control={control}
              answer={answers.get(control.id)}
              target={assessment.targetMaturity}
              open={openId === control.id}
              onToggle={() => setOpenId(openId === control.id ? null : control.id)}
              onChange={update}
              onNext={() => goToNextPending(control.id)}
              save={saveState[control.id]}
              onRetry={() => {
                const a = answers.get(control.id);
                if (a) persist(a);
              }}
              evidence={evidence.filter((e) => e.controlId === control.id)}
              canAddEvidence={stored.has(control.id)}
              onEvidenceAdded={(ev) => setEvidence((list) => [...list, ev])}
              assessmentId={assessment.id}
              readOnly={readOnly}
            />
          ))}
        </section>
      </div>
    </div>
  );
}

function AssessmentHeader({
  assessment,
  onChange,
  readOnly,
}: {
  assessment: Assessment;
  onChange: (a: Assessment) => void;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(assessment.name);
  const [target, setTarget] = useState(assessment.targetMaturity);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      onChange(await api<Assessment>(`/assessments/${assessment.id}`, { method: "PATCH", body: { name: name.trim(), targetMaturity: target } }));
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="grid gap-3">
      <Link href="/evaluaciones" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Evaluaciones
      </Link>
      {editing ? (
        <form onSubmit={save} className="grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-[1fr_14rem_auto] md:items-end">
          <div className="md:col-span-3">
            <FormError message={error} />
          </div>
          <Field id="assessment-name" label="Nombre">
            <Input id="assessment-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="assessment-target" label="Madurez objetivo">
            <NativeSelect id="assessment-target" value={target} onChange={(e) => setTarget(Number(e.target.value))}>
              {MATURITY_LEVELS.filter((l) => l.value >= 1).map((l) => (
                <option key={l.value} value={l.value}>
                  {l.value} · {l.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={!name.trim()}>
              Guardar
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">{assessment.name}</h1>
            <p className="text-sm text-muted-foreground">
              ISO/IEC 27001:2022 · Objetivo: {assessment.targetMaturity} · {MATURITY_LEVELS[assessment.targetMaturity]?.label}
              {readOnly && " · Solo lectura"}
            </p>
          </div>
          {!readOnly && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil aria-hidden /> Editar datos
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ answer, target }: { answer: Answer | undefined; target: number }) {
  const status = statusOf(answer);
  if (status === "pending") {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <CircleDashed aria-hidden /> Pendiente
      </Badge>
    );
  }
  if (status === "not_applicable") return <Badge variant="secondary">No aplica</Badge>;
  const maturity = answer?.maturity ?? 0;
  return <Badge variant={maturity >= target ? "success" : "warning"}>Madurez {maturity}</Badge>;
}

function SaveIndicator({ state, onRetry }: { state: SaveState | undefined; onRetry: () => void }) {
  if (!state) return null;
  const content = {
    saving: (
      <>
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Guardando…
      </>
    ),
    saved: (
      <>
        <Check className="size-3.5 text-success" aria-hidden /> Guardado
      </>
    ),
    invalid: (
      <>
        <AlertCircle className="size-3.5 text-warning" aria-hidden /> Falta la justificación para guardar
      </>
    ),
    error: (
      <>
        <AlertCircle className="size-3.5 text-destructive" aria-hidden /> No se pudo guardar.{" "}
        <button type="button" className="font-medium text-primary hover:underline" onClick={onRetry}>
          Reintentar
        </button>
      </>
    ),
  }[state];
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" role="status">
      {content}
    </span>
  );
}

function ControlItem({
  control,
  answer,
  target,
  open,
  onToggle,
  onChange,
  onNext,
  save,
  onRetry,
  evidence,
  canAddEvidence,
  onEvidenceAdded,
  assessmentId,
  readOnly,
}: {
  control: Control;
  answer: Answer | undefined;
  target: number;
  open: boolean;
  onToggle: () => void;
  onChange: (answer: Answer, opts?: { debounce?: boolean }) => void;
  onNext: () => void;
  save: SaveState | undefined;
  onRetry: () => void;
  evidence: Evidence[];
  canAddEvidence: boolean;
  onEvidenceAdded: (ev: Evidence) => void;
  assessmentId: string;
  readOnly: boolean;
}) {
  const current: Answer = answer ?? { controlId: control.id, applicable: true };
  const set = (patch: Partial<Answer>, opts?: { debounce?: boolean }) => onChange({ ...current, ...patch }, opts);
  const panelId = `control-panel-${control.id}`;

  return (
    <Card id={`control-${control.id}`} className={cn("scroll-mt-20", open && "border-primary/40")}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left hover:bg-accent/50"
      >
        <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">{control.id}</span>
        <span className="flex-1 text-sm font-medium">{control.title}</span>
        <StatusBadge answer={answer} target={target} />
        {evidence.length > 0 && (
          <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex" title="Evidencia registrada">
            <FileText className="size-3.5" aria-hidden /> {evidence.length}
          </span>
        )}
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div id={panelId} className="grid gap-5 border-t px-4 py-4">
          <fieldset className="grid gap-2" disabled={readOnly}>
            <legend className="text-sm font-medium">¿Aplica a tu organización?</legend>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={current.applicable ? "default" : "outline"}
                aria-pressed={current.applicable}
                onClick={() => set({ applicable: true })}
              >
                Sí, aplica
              </Button>
              <Button
                type="button"
                size="sm"
                variant={!current.applicable ? "default" : "outline"}
                aria-pressed={!current.applicable}
                onClick={() => set({ applicable: false, maturity: undefined })}
              >
                No aplica
              </Button>
            </div>
          </fieldset>

          {current.applicable && (
            <MaturityPicker value={current.maturity ?? undefined} target={target} readOnly={readOnly} onChange={(maturity) => set({ maturity })} />
          )}

          <Field
            id={`justification-${control.id}`}
            label={current.applicable ? "Notas (opcional)" : "¿Por qué no aplica? (obligatorio)"}
            hint={
              current.applicable
                ? "Cómo se implementa hoy, qué falta, responsables… Ayuda a la próxima revisión."
                : "Queda registrado en la Declaración de Aplicabilidad que revisa el auditor."
            }
          >
            <Textarea
              id={`justification-${control.id}`}
              maxLength={2000}
              readOnly={readOnly}
              aria-invalid={!current.applicable && !current.justification?.trim()}
              aria-describedby={`justification-${control.id}-hint`}
              value={current.justification ?? ""}
              onChange={(e) => set({ justification: e.target.value }, { debounce: true })}
            />
          </Field>

          <EvidenceSection
            controlId={control.id}
            assessmentId={assessmentId}
            evidence={evidence}
            canAdd={canAddEvidence && !readOnly}
            readOnly={readOnly}
            onAdded={onEvidenceAdded}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <SaveIndicator state={save} onRetry={onRetry} />
            {!readOnly && (
              <Button type="button" size="sm" onClick={onNext}>
                Siguiente pendiente <SkipForward aria-hidden />
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/** Selector 0-4. Volver a tocar el nivel elegido lo desmarca (queda pendiente). */
function MaturityPicker({
  value,
  target,
  readOnly,
  onChange,
}: {
  value: number | undefined;
  target: number;
  readOnly: boolean;
  onChange: (value: number | undefined) => void;
}) {
  const selected = MATURITY_LEVELS.find((l) => l.value === value);
  const labelId = useId();
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span id={labelId} className="text-sm font-medium">
          Madurez actual
        </span>
        <span className="text-xs text-muted-foreground">
          Objetivo: {target} · {MATURITY_LEVELS[target]?.label}
        </span>
      </div>
      <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-5 gap-1.5">
        {MATURITY_LEVELS.map((level) => {
          const checked = level.value === value;
          return (
            <button
              key={level.value}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={readOnly}
              onClick={() => onChange(checked ? undefined : level.value)}
              title={level.description}
              className={cn(
                "grid gap-0.5 rounded-md border px-1 py-2 text-center text-xs transition-colors hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent",
                checked && (level.value >= target ? "border-success bg-success/10" : "border-warning bg-warning/10"),
                level.value === target && !checked && "border-dashed border-primary/50",
              )}
            >
              <span className="text-base font-semibold">{level.value}</span>
              <span className="leading-tight">{level.label}</span>
            </button>
          );
        })}
      </div>
      <p className="min-h-5 text-xs text-muted-foreground">
        {selected ? selected.description : "Elegí el nivel que mejor describe cómo se aplica hoy este control."}
      </p>
    </div>
  );
}

function EvidenceSection({
  controlId,
  assessmentId,
  evidence,
  canAdd,
  readOnly,
  onAdded,
}: {
  controlId: string;
  assessmentId: string;
  evidence: Evidence[];
  canAdd: boolean;
  readOnly: boolean;
  onAdded: (ev: Evidence) => void;
}) {
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const ev = await api<Evidence>(`/assessments/${assessmentId}/evidence`, {
        body: { controlId, source: "manual", description: description.trim() },
      });
      onAdded(ev);
      setDescription("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">Evidencia</span>
      {evidence.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin evidencia registrada.</p>
      ) : (
        <ul className="grid gap-1.5">
          {evidence.map((ev) => (
            <li key={ev.id} className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm">
              <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex-1 break-words">{ev.description}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {new Date(ev.collectedAt).toLocaleDateString("es-AR")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!readOnly &&
        (canAdd ? (
          <form onSubmit={add} className="grid gap-2">
            <FormError message={error} />
            <div className="flex gap-2">
              <Input
                aria-label="Descripción de la evidencia"
                placeholder="Ej.: Política de accesos v2 aprobada en marzo (link al documento)"
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <Button type="submit" variant="outline" disabled={pending || !description.trim()}>
                Agregar
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">Respondé el control para poder adjuntar evidencia.</p>
        ))}
    </div>
  );
}

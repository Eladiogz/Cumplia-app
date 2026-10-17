"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, ClipboardList, Plus } from "lucide-react";
import { Field, FormError, Spinner } from "@/components/form";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { MATURITY_LEVELS } from "@cumplia/core/maturity";
import { api, errorMessage } from "@/lib/api";
import { percent } from "@/lib/assessment";
import { canEditAssessments } from "@/lib/roles";
import { useMe } from "@/lib/session";
import type { Assessment, AssessmentSummary } from "@/lib/types";

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });

export default function AssessmentsPage() {
  const { me } = useMe();
  const canEdit = canEditAssessments(me.role);
  const [list, setList] = useState<AssessmentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api<AssessmentSummary[]>("/assessments")
      .then(setList)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  return (
    <>
      <PageHeader
        title="Evaluaciones"
        description="Gap assessment frente a ISO/IEC 27001:2022: madurez de cada control, exclusiones justificadas y evidencia."
        actions={
          canEdit &&
          !creating && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> Nueva evaluación
            </Button>
          )
        }
      />
      <div className="grid gap-4">
        {creating && <NewAssessment onCancel={() => setCreating(false)} />}
        <FormError message={error} />
        {!list ? (
          !error && <Spinner />
        ) : list.length === 0 ? (
          <Card>
            <CardContent className="grid justify-items-center gap-3 py-10 text-center">
              <ClipboardList className="size-8 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">
                {canEdit
                  ? "Todavía no hay evaluaciones. Creá la primera para medir dónde está tu organización."
                  : "Todavía no hay evaluaciones en esta organización."}
              </p>
            </CardContent>
          </Card>
        ) : (
          list.map((a) => {
            const done = percent(a.answered, a.total);
            return (
              <Link key={a.id} href={`/evaluaciones/${a.id}`} className="group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Card className="transition-colors group-hover:border-primary/40">
                  <CardHeader className="flex-row items-start justify-between gap-4">
                    <div className="grid gap-1">
                      <CardTitle>{a.name}</CardTitle>
                      <CardDescription>
                        ISO/IEC 27001:2022 · Objetivo: {MATURITY_LEVELS[a.targetMaturity]?.label} ({a.targetMaturity}) · Actualizada el{" "}
                        {formatDate(a.updatedAt)}
                      </CardDescription>
                    </div>
                    {done === 100 ? <Badge variant="success">Completa</Badge> : <Badge variant="secondary">En curso</Badge>}
                  </CardHeader>
                  <CardContent className="grid gap-2">
                    <Progress value={done} label={`Avance de ${a.name}`} />
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {a.answered} de {a.total} controles resueltos ({done}%)
                      </span>
                      <span className="inline-flex items-center gap-1 font-medium text-primary">
                        {canEdit ? "Continuar" : "Ver"} <ArrowRight className="size-3.5" aria-hidden />
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })
        )}
      </div>
    </>
  );
}

function NewAssessment({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const year = new Date().getFullYear();
  const [name, setName] = useState(`Gap ISO 27001 ${year}`);
  const [target, setTarget] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const created = await api<Assessment>("/assessments", {
        body: { frameworkId: "iso27001-2022", name: name.trim(), targetMaturity: target },
      });
      router.push(`/evaluaciones/${created.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nueva evaluación</CardTitle>
        <CardDescription>Vas a recorrer los 93 controles del Anexo A. El avance se guarda solo, podés seguir otro día.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4 md:grid-cols-[1fr_16rem] md:items-start">
          <div className="md:col-span-2">
            <FormError message={error} />
          </div>
          <Field id="name" label="Nombre">
            <Input id="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="target" label="Madurez objetivo" hint="Debajo de este nivel, el control cuenta como brecha.">
            <NativeSelect id="target" aria-describedby="target-hint" value={target} onChange={(e) => setTarget(Number(e.target.value))}>
              {MATURITY_LEVELS.filter((l) => l.value >= 1).map((l) => (
                <option key={l.value} value={l.value}>
                  {l.value} · {l.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="flex gap-2 md:col-span-2">
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? "Creando…" : "Crear y empezar"}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

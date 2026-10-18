"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AlertOctagon, AlertTriangle, ArrowLeft, ArrowRight, CircleAlert, ClipboardList, Info } from "lucide-react";
import { MATURITY_LEVELS } from "@cumplia/core/maturity";
import { ChartCard, DomainBars, DomainTable, MaturityColumns, MaturityTable, Meter } from "@/components/charts";
import { FormError, Spinner } from "@/components/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { GAP_LABEL, formatNumber, formatPercent, gapSeverity, shortDomain, type GapSeverity } from "@/lib/format";
import { canEditAssessments } from "@/lib/roles";
import { useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { Assessment, AssessmentResult, Gap } from "@/lib/types";

export default function AssessmentResultPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useMe();
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api<Assessment>(`/assessments/${id}`), api<AssessmentResult>(`/assessments/${id}/result`)])
      .then(([a, r]) => {
        setAssessment(a);
        setResult(r);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);

  if (error) return <FormError message={error} />;
  if (!assessment || !result) return <Spinner />;

  const assessed = result.applicable - result.pending;
  const target = MATURITY_LEVELS[result.targetMaturity];

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <Link href="/evaluaciones" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> Evaluaciones
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Resultado · {assessment.name}</h1>
            <p className="text-sm text-muted-foreground">
              ISO/IEC 27001:2022 · Objetivo: {result.targetMaturity} · {target?.label}
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href={`/evaluaciones/${id}`}>
              <ClipboardList aria-hidden /> {canEditAssessments(me.role) ? "Seguir evaluando" : "Ver respuestas"}
            </Link>
          </Button>
        </div>
      </div>

      {assessed === 0 ? (
        <Card>
          <CardContent className="grid justify-items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">Todavía no hay controles evaluados: el resultado aparece a medida que asignás madurez.</p>
            <Button asChild>
              <Link href={`/evaluaciones/${id}`}>Empezar a evaluar</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {result.pending > 0 && (
            <Alert>
              <Info aria-hidden />
              <AlertDescription>
                Resultado parcial: evaluaste {assessed} de {result.applicable} controles aplicables ({formatPercent(result.coverage)}). Los
                puntajes consideran solo lo evaluado; los pendientes no cuentan como cero.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(16rem,20rem)_1fr]">
            <Card>
              <CardHeader>
                <CardDescription>Puntaje de madurez</CardDescription>
                <p className="text-5xl font-semibold tracking-tight">{formatPercent(result.overallScore)}</p>
                <p className="text-sm text-muted-foreground">
                  Madurez promedio <strong className="text-foreground">{formatNumber(result.averageMaturity ?? 0)}</strong> de 4 · objetivo{" "}
                  {result.targetMaturity}
                </p>
              </CardHeader>
              <CardContent className="grid gap-1.5">
                <Meter value={result.coverage} label="Cobertura de la evaluación" />
                <span className="text-xs text-muted-foreground">
                  {formatPercent(result.coverage)} evaluado · {result.pending} pendiente{result.pending === 1 ? "" : "s"}
                </span>
              </CardContent>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <StatTile
                label="Alcanzan el objetivo"
                value={`${result.meetingTarget} de ${assessed}`}
                detail={`${formatPercent((result.meetingTarget / assessed) * 100)} de lo evaluado`}
                meter={(result.meetingTarget / assessed) * 100}
              />
              <StatTile label="Brechas" value={String(result.gaps.length)} detail={`Controles por debajo del nivel ${result.targetMaturity}`} />
              <StatTile label="Aplicables" value={String(result.applicable)} detail={`${result.notApplicable} excluidos con justificación (SoA)`} />
              <StatTile label="Pendientes de evaluar" value={String(result.pending)} detail="Aplican pero todavía sin madurez" />
            </div>
          </div>

          {/* Lado a lado solo en pantallas muy anchas: así cada gráfico tiene lugar para sus etiquetas. */}
          <div className="grid gap-4 2xl:grid-cols-2">
            <ChartCard
              title="Madurez por dominio"
              description="Puntaje de cada dominio (0-100 %) frente al objetivo."
              chart={<DomainBars domains={result.byDomain} target={result.targetMaturity} />}
              table={<DomainTable domains={result.byDomain} />}
            />
            <ChartCard
              title="Controles por nivel de madurez"
              description="Cuántos controles evaluados hay en cada nivel."
              chart={<MaturityColumns distribution={result.distribution} target={result.targetMaturity} />}
              table={<MaturityTable distribution={result.distribution} />}
            />
          </div>

          <GapsTable assessmentId={id} gaps={result.gaps} domains={result.byDomain.map((d) => ({ domain: d.domain, label: d.label }))} />
        </>
      )}
    </div>
  );
}

function StatTile({ label, value, detail, meter }: { label: string; value: string; detail: string; meter?: number }) {
  return (
    <Card>
      <CardContent className="grid gap-1 pt-6">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-2xl font-semibold">{value}</span>
        {meter !== undefined && <Meter value={meter} label={label} />}
        <span className="text-xs text-muted-foreground">{detail}</span>
      </CardContent>
    </Card>
  );
}

const SEVERITY_ICON = { critical: AlertOctagon, serious: AlertTriangle, warning: CircleAlert } as const;
const SEVERITY_COLOR: Record<GapSeverity, string> = {
  critical: "text-destructive",
  serious: "text-serious",
  warning: "text-warning",
};

/** Estado de una brecha: siempre ícono + etiqueta, nunca solo color. */
function SeverityBadge({ gap }: { gap: number }) {
  const severity = gapSeverity(gap);
  const Icon = SEVERITY_ICON[severity];
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium">
      <Icon className={cn("size-3.5", SEVERITY_COLOR[severity])} aria-hidden />
      {GAP_LABEL[severity]}
    </span>
  );
}

const INITIAL_ROWS = 15;

function GapsTable({ assessmentId, gaps, domains }: { assessmentId: string; gaps: Gap[]; domains: { domain: string; label: string }[] }) {
  const [domain, setDomain] = useState("");
  const [showAll, setShowAll] = useState(false);
  const labelOf = useMemo(() => new Map(domains.map((d) => [d.domain, d.label])), [domains]);
  const filtered = domain ? gaps.filter((g) => g.domain === domain) : gaps;
  const rows = showAll ? filtered : filtered.slice(0, INITIAL_ROWS);
  const openHref = (controlId: string) => `/evaluaciones/${assessmentId}?control=${encodeURIComponent(controlId)}`;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1.5">
          <CardTitle>Brechas priorizadas</CardTitle>
          <CardDescription>Controles por debajo del objetivo, primero los que están más lejos. Son la base del plan de acción.</CardDescription>
        </div>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Dominio
          <NativeSelect className="w-48" value={domain} onChange={(e) => setDomain(e.target.value)}>
            <option value="">Todos ({gaps.length})</option>
            {domains.map((d) => (
              <option key={d.domain} value={d.domain}>
                {shortDomain(d.label)} ({gaps.filter((g) => g.domain === d.domain).length})
              </option>
            ))}
          </NativeSelect>
        </label>
      </CardHeader>
      <CardContent className="grid gap-3">
        {filtered.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No hay brechas{domain ? " en este dominio" : ""} entre los controles evaluados.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-4 font-medium">Control</th>
                  <th className="hidden py-2 pr-4 font-medium md:table-cell">Dominio</th>
                  <th className="py-2 pr-4 text-right font-medium">Actual</th>
                  <th className="hidden py-2 pr-4 text-right font-medium sm:table-cell">Objetivo</th>
                  <th className="py-2 pr-4 font-medium">Brecha</th>
                  <th className="hidden py-2 font-medium sm:table-cell" aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {rows.map((g) => (
                  <tr key={g.controlId} className="border-b last:border-0">
                    <td className="py-2.5 pr-4">
                      {/* El título también abre el control: en celular la columna "Abrir" no se muestra. */}
                      <Link href={openHref(g.controlId)} className="hover:underline">
                        <span className="mr-2 font-mono text-xs text-muted-foreground">{g.controlId}</span>
                        {g.title}
                      </Link>
                    </td>
                    <td className="hidden py-2.5 pr-4 text-muted-foreground md:table-cell">{shortDomain(labelOf.get(g.domain) ?? "")}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{g.maturity}</td>
                    <td className="hidden py-2.5 pr-4 text-right tabular-nums sm:table-cell">{g.target}</td>
                    <td className="whitespace-nowrap py-2.5 pr-4">
                      <SeverityBadge gap={g.gap} />
                      <span className="ml-1 text-xs text-muted-foreground">(−{g.gap})</span>
                    </td>
                    <td className="hidden py-2.5 text-right sm:table-cell">
                      <Link
                        href={openHref(g.controlId)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        Abrir <ArrowRight className="size-3" aria-hidden />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > INITIAL_ROWS && (
          <Button variant="ghost" size="sm" className="w-fit" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Mostrar menos" : `Ver todas (${filtered.length})`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

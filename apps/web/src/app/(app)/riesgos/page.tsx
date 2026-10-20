"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Download, Plus, Search, ShieldAlert, X } from "lucide-react";
import {
  RISK_LEVELS,
  RISK_LEVEL_LABEL,
  RISK_STATUSES,
  RISK_STATUS_LABEL,
  RISK_TREATMENT_LABEL,
  riskCode,
  type RiskLevel,
} from "@cumplia/core/risk";
import { ChartCard } from "@/components/charts";
import { FormError, Spinner } from "@/components/form";
import { PageHeader } from "@/components/page-header";
import { LEVEL_ICON, LEVEL_ICON_COLOR, RiskLevelBadge } from "@/components/risk-level";
import { RiskMatrix, RiskMatrixTable } from "@/components/risk-matrix";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { byScore, filterRisks, formatDueDate, isOverdue, levelIn, type MatrixMode } from "@/lib/risk";
import { canEditRisks } from "@/lib/roles";
import { useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { Risk } from "@/lib/types";

export default function RisksPage() {
  const { me } = useMe();
  const canEdit = canEditRisks(me.role);
  const [risks, setRisks] = useState<Risk[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<MatrixMode>("inherent");
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<RiskLevel | "">("");
  const [status, setStatus] = useState<Risk["status"] | "">("");
  const [cell, setCell] = useState<string | null>(null);

  useEffect(() => {
    api<Risk[]>("/risks")
      .then((list) => setRisks(list.sort(byScore)))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  const filtered = useMemo(
    () => (risks ? filterRisks(risks, { query, level, status, cell, mode }) : []),
    [risks, query, level, status, cell, mode],
  );

  const changeMode = (m: MatrixMode) => {
    setMode(m);
    setCell(null); // la celda elegida es de la otra vista
  };

  const filtering = query !== "" || level !== "" || status !== "" || cell !== null;
  const clearFilters = () => {
    setQuery("");
    setLevel("");
    setStatus("");
    setCell(null);
  };

  return (
    <>
      <PageHeader
        title="Riesgos"
        description="Registro de riesgos de seguridad de la información (ISO/IEC 27001 6.1.2 y 6.1.3): probabilidad × impacto, tratamiento, controles y responsable."
        actions={
          <div className="flex flex-wrap gap-2">
            {risks && risks.length > 0 && <ExportButton verified={me.emailVerified} />}
            {canEdit && (
              <Button asChild>
                <Link href="/riesgos/nuevo">
                  <Plus aria-hidden /> Nuevo riesgo
                </Link>
              </Button>
            )}
          </div>
        }
      />
      {/* minmax(0,1fr): la columna no se estira por la tabla ancha (la tabla hace su propio scroll). */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <FormError message={error} />
        {!risks ? (
          !error && <Spinner />
        ) : risks.length === 0 ? (
          <Card>
            <CardContent className="grid justify-items-center gap-3 py-10 text-center">
              <ShieldAlert className="size-8 text-muted-foreground" aria-hidden />
              <p className="max-w-md text-sm text-muted-foreground">
                {canEdit
                  ? "Todavía no hay riesgos. Registrá el primero: qué puede salir mal, sobre qué activo, qué tan probable es y cuánto impactaría."
                  : "Todavía no hay riesgos registrados en esta organización."}
              </p>
              {canEdit && (
                <Button asChild variant="outline">
                  <Link href="/riesgos/nuevo">
                    <Plus aria-hidden /> Registrar un riesgo
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            <LevelSummary risks={risks} mode={mode} />
            <ChartCard
              title="Mapa de calor"
              description={
                mode === "inherent"
                  ? "Riesgo inherente: antes de aplicar el tratamiento. Elegí una celda para filtrar la lista."
                  : `Riesgo residual: después del tratamiento. ${withoutResidual(risks)}`
              }
              actions={<ModeSwitch mode={mode} onChange={changeMode} />}
              chart={<RiskMatrix risks={risks} mode={mode} selected={cell} onSelect={setCell} />}
              table={<RiskMatrixTable risks={risks} mode={mode} />}
            />

            <div className="flex flex-wrap items-end gap-2">
              <div className="relative min-w-48 flex-1 basis-full sm:basis-0">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  className="pl-9"
                  placeholder="Buscar por código, riesgo, activo o amenaza"
                  aria-label="Buscar riesgos"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <NativeSelect
                className="w-auto"
                aria-label={`Filtrar por nivel ${mode === "inherent" ? "inherente" : "residual"}`}
                value={level}
                onChange={(e) => setLevel(e.target.value as RiskLevel | "")}
              >
                <option value="">Todos los niveles</option>
                {[...RISK_LEVELS].reverse().map((l) => (
                  <option key={l} value={l}>
                    {RISK_LEVEL_LABEL[l]}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                className="w-auto"
                aria-label="Filtrar por estado"
                value={status}
                onChange={(e) => setStatus(e.target.value as Risk["status"] | "")}
              >
                <option value="">Todos los estados</option>
                {RISK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {RISK_STATUS_LABEL[s]}
                  </option>
                ))}
              </NativeSelect>
              {filtering && (
                <Button variant="ghost" onClick={clearFilters}>
                  <X aria-hidden /> Limpiar filtros
                </Button>
              )}
            </div>
            {cell && (
              <p className="text-sm text-muted-foreground">
                Mostrando la celda probabilidad {cell.split("-")[0]} × impacto {cell.split("-")[1]} ({mode === "inherent" ? "inherente" : "residual"}).
              </p>
            )}
            <p className="text-xs text-muted-foreground" role="status">
              {filtered.length} de {risks.length} riesgo{risks.length === 1 ? "" : "s"}
            </p>
            {filtered.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">Ningún riesgo coincide con los filtros.</CardContent>
              </Card>
            ) : (
              <RiskList risks={filtered} />
            )}
          </>
        )}
      </div>
    </>
  );
}

const withoutResidual = (risks: Risk[]) => {
  const n = risks.filter((r) => r.residualLikelihood === null).length;
  return n === 0 ? "" : `${n} riesgo${n === 1 ? "" : "s"} sin residual evaluado no aparece${n === 1 ? "" : "n"}.`;
};

function ExportButton({ verified }: { verified: boolean }) {
  if (!verified) {
    return (
      <Button variant="outline" disabled title="Confirmá tu email para exportar">
        <Download aria-hidden /> Exportar Excel
      </Button>
    );
  }
  return (
    <Button asChild variant="outline">
      <a href="/api/risks.xlsx" download>
        <Download aria-hidden /> Exportar Excel
      </a>
    </Button>
  );
}

function ModeSwitch({ mode, onChange }: { mode: MatrixMode; onChange: (m: MatrixMode) => void }) {
  return (
    <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Vista del mapa">
      {(["inherent", "residual"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
          className={cn(
            "rounded-sm px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
          )}
        >
          {m === "inherent" ? "Inherente" : "Residual"}
        </button>
      ))}
    </div>
  );
}

/** Cantidad por nivel (de la vista elegida), con ícono + etiqueta, y vencidos. */
function LevelSummary({ risks, mode }: { risks: Risk[]; mode: MatrixMode }) {
  const overdue = risks.filter((r) => isOverdue(r)).length;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {[...RISK_LEVELS].reverse().map((l) => {
        const Icon = LEVEL_ICON[l];
        const n = risks.filter((r) => levelIn(r, mode)?.level === l).length;
        return (
          <Card key={l} className="py-0">
            <CardContent className="grid gap-1 p-3">
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className={cn("size-3.5", LEVEL_ICON_COLOR[l])} aria-hidden /> {RISK_LEVEL_LABEL[l]}
              </span>
              <span className="text-2xl font-semibold tabular-nums">{n}</span>
            </CardContent>
          </Card>
        );
      })}
      <Card className="col-span-2 py-0 sm:col-span-1">
        <CardContent className="grid gap-1 p-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className={cn("size-3.5", overdue > 0 && "text-destructive")} aria-hidden /> Vencidos
          </span>
          <span className="text-2xl font-semibold tabular-nums">{overdue}</span>
        </CardContent>
      </Card>
    </div>
  );
}

function Owner({ r }: { r: Risk }) {
  if (!r.ownerEmail) return <span className="text-muted-foreground">Sin asignar</span>;
  return <span title={r.ownerEmail}>{r.ownerName ?? r.ownerEmail}</span>;
}

function Due({ r }: { r: Risk }) {
  if (!r.dueDate) return <span className="text-muted-foreground">—</span>;
  const late = isOverdue(r);
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", late && "font-medium text-destructive")}>
      {late && <CalendarClock className="size-3.5" aria-hidden />}
      {formatDueDate(r.dueDate)}
      {late && <span className="sr-only"> (vencido)</span>}
    </span>
  );
}

function RiskList({ risks }: { risks: Risk[] }) {
  return (
    <>
      {/* Pantallas angostas: tarjetas. */}
      <div className="grid gap-2 md:hidden">
        {risks.map((r) => {
          const inherent = levelIn(r, "inherent")!;
          const residual = levelIn(r, "residual");
          return (
            <Link key={r.id} href={`/riesgos/${r.id}`} className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className="py-0 transition-colors hover:border-primary/40">
                <CardContent className="grid gap-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid min-w-0 gap-0.5">
                      <span className="text-xs text-muted-foreground">{riskCode(r.number)}</span>
                      <span className="font-medium [overflow-wrap:anywhere]">{r.title}</span>
                    </div>
                    <RiskLevelBadge level={inherent.level} score={inherent.score} />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{RISK_STATUS_LABEL[r.status]}</span>
                    <span>{RISK_TREATMENT_LABEL[r.treatment]}</span>
                    {residual && (
                      <span className="inline-flex items-center gap-1">
                        Residual: <RiskLevelBadge level={residual.level} score={residual.score} />
                      </span>
                    )}
                    <Owner r={r} />
                    {r.dueDate && <Due r={r} />}
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <Card className="hidden py-0 md:block">
        {/* relative: lo posicionado adentro (p. ej. textos sr-only) queda dentro del scroll y no ensancha la página. */}
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-3 font-medium">Código</th>
                <th className="px-4 py-3 font-medium">Riesgo</th>
                <th className="px-4 py-3 font-medium">Inherente</th>
                <th className="px-4 py-3 font-medium">Residual</th>
                <th className="px-4 py-3 font-medium">Estado · tratamiento</th>
                <th className="px-4 py-3 font-medium">Responsable · vence</th>
              </tr>
            </thead>
            <tbody>
              {risks.map((r) => {
                const inherent = levelIn(r, "inherent")!;
                const residual = levelIn(r, "residual");
                return (
                  <tr key={r.id} className="border-b align-top last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums">{riskCode(r.number)}</td>
                    <td className="min-w-56 px-4 py-3">
                      <Link href={`/riesgos/${r.id}`} className="font-medium text-primary underline-offset-4 hover:underline [overflow-wrap:anywhere]">
                        {r.title}
                      </Link>
                      {r.asset && <div className="text-xs text-muted-foreground">{r.asset}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <RiskLevelBadge level={inherent.level} score={inherent.score} />
                    </td>
                    <td className="px-4 py-3">
                      {residual ? <RiskLevelBadge level={residual.level} score={residual.score} /> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div>{RISK_STATUS_LABEL[r.status]}</div>
                      <div className="text-xs text-muted-foreground">{RISK_TREATMENT_LABEL[r.treatment]}</div>
                    </td>
                    <td className="max-w-48 px-4 py-3">
                      <div className="truncate">
                        <Owner r={r} />
                      </div>
                      {r.dueDate && (
                        <div className="text-xs">
                          <Due r={r} />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

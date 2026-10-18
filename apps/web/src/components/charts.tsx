"use client";

import { useState, type ReactNode } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { MATURITY_LEVELS } from "@cumplia/core/maturity";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber, formatPercent, shortDomain } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DomainScore } from "@/lib/types";

/*
 * Gráficos del tablero (HTML + CSS, sin librerías). Reglas de la guía de datos:
 * marcas finas (barras <= 24 px, extremo redondeado de 4 px y base recta), grilla
 * en línea fina sólida, etiquetas con colores de texto (nunca el de la serie),
 * tooltip con mouse Y teclado, y siempre una vista de tabla equivalente.
 */

/** Tarjeta de gráfico con alternancia "gráfico / tabla" (la tabla es el equivalente accesible). */
export function ChartCard({
  title,
  description,
  chart,
  table,
  actions,
}: {
  title: string;
  description?: string;
  chart: ReactNode;
  table: ReactNode;
  /** Controles extra del encabezado (p. ej. cambiar de vista). */
  actions?: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1.5">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <Button variant="ghost" size="sm" onClick={() => setAsTable(!asTable)} aria-pressed={asTable}>
            {asTable ? <BarChart3 aria-hidden /> : <Table2 aria-hidden />}
            {asTable ? "Ver gráfico" : "Ver como tabla"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>{asTable ? table : chart}</CardContent>
    </Card>
  );
}

/** Tooltip: el valor primero (fuerte), la etiqueta después. */
export function Tip({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <div
      role="tooltip"
      className={cn(
        "pointer-events-none absolute z-10 grid w-max max-w-64 gap-0.5 rounded-md border bg-popover px-3 py-2 text-xs shadow-md",
        className,
      )}
    >
      <span className="text-sm font-semibold text-foreground">{value}</span>
      <span className="text-muted-foreground">{children}</span>
    </div>
  );
}

const TICKS = [0, 25, 50, 75, 100];
/** Fila etiqueta + barra; en pantallas angostas la etiqueta va arriba de la barra. */
const ROW = "grid grid-cols-1 gap-x-4 sm:grid-cols-[minmax(6rem,9rem)_1fr]";

/**
 * Puntaje por dominio (0-100 %) en barras horizontales de una sola serie, con la
 * línea del objetivo. Una serie = un color (sin leyenda: el título la nombra).
 */
export function DomainBars({ domains, target }: { domains: DomainScore[]; target: number }) {
  const [active, setActive] = useState<string | null>(null);
  const targetPct = (target / 4) * 100;

  return (
    <div className="grid gap-2">
      <div className={ROW}>
        <div className="hidden sm:block" />
        <div className="relative h-5 text-xs text-muted-foreground">
          <span className="absolute -translate-x-1/2 whitespace-nowrap font-medium text-foreground" style={{ left: `${targetPct}%` }}>
            Objetivo {formatPercent(targetPct)}
          </span>
        </div>
      </div>
      {domains.map((d) => {
        const show = active === d.domain;
        const empty = d.assessed === 0;
        return (
          <div key={d.domain} className={cn(ROW, "items-center")}>
            <span className="text-sm">{shortDomain(d.label)}</span>
            <div
              className="relative h-9 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              tabIndex={0}
              aria-label={
                empty
                  ? `${d.label}: sin controles evaluados`
                  : `${d.label}: ${formatPercent(d.score)}, madurez promedio ${formatNumber(d.average ?? 0)} de 4`
              }
              onPointerEnter={() => setActive(d.domain)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(d.domain)}
              onBlur={() => setActive(null)}
            >
              {TICKS.map((t) => (
                <span
                  key={t}
                  aria-hidden
                  className="absolute inset-y-0 w-px"
                  style={{ left: `${t}%`, background: t === 0 ? "var(--chart-baseline)" : "var(--chart-grid)" }}
                />
              ))}
              {empty ? (
                <span className="absolute inset-y-0 left-2 flex items-center text-xs text-muted-foreground">Sin evaluar</span>
              ) : (
                <>
                  <span
                    aria-hidden
                    className={cn("absolute top-1/2 h-5 -translate-y-1/2 rounded-r-[4px] transition-opacity", active && !show && "opacity-60")}
                    style={{ left: 0, width: `${Math.max(d.score, 0.5)}%`, background: "var(--chart-series)" }}
                  />
                  {/* Con fondo propio y por encima: la línea del objetivo pasa por detrás, nunca lo tapa. */}
                  <span
                    aria-hidden
                    className={cn(
                      "absolute top-1/2 z-10 -translate-y-1/2 rounded px-1 text-xs font-medium tabular-nums",
                      d.score > 86 ? "mr-1 text-white" : "ml-1 bg-card text-foreground",
                    )}
                    style={d.score > 86 ? { right: `${100 - d.score}%` } : { left: `${d.score}%` }}
                  >
                    {formatPercent(d.score)}
                  </span>
                </>
              )}
              <span aria-hidden className="absolute inset-y-0 w-px" style={{ left: `${targetPct}%`, background: "var(--chart-target)" }} />
              {show && (
                <Tip value={empty ? "Sin evaluar" : formatPercent(d.score)} className="bottom-full left-1/2 mb-1 -translate-x-1/2">
                  {d.label} · {d.assessed} de {d.applicable} evaluados
                  {d.average !== null && ` · promedio ${formatNumber(d.average)} de 4`}
                  {` · ${d.meetingTarget} alcanzan el objetivo`}
                </Tip>
              )}
            </div>
          </div>
        );
      })}
      <div className={ROW}>
        <div className="hidden sm:block" />
        <div className="relative h-4 text-xs tabular-nums text-muted-foreground" aria-hidden>
          {TICKS.map((t) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: `${t}%` }}>
              {t}%
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DomainTable({ domains }: { domains: DomainScore[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr className="border-b">
          <th className="py-2 pr-4 font-medium">Dominio</th>
          <th className="py-2 pr-4 text-right font-medium">Puntaje</th>
          <th className="py-2 pr-4 text-right font-medium">Promedio (0-4)</th>
          <th className="py-2 pr-4 text-right font-medium">Evaluados</th>
          <th className="py-2 text-right font-medium">Alcanzan el objetivo</th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {domains.map((d) => (
          <tr key={d.domain} className="border-b last:border-0">
            <td className="py-2 pr-4">{shortDomain(d.label)}</td>
            <td className="py-2 pr-4 text-right">{d.assessed ? formatPercent(d.score) : "—"}</td>
            <td className="py-2 pr-4 text-right">{d.average !== null ? formatNumber(d.average) : "—"}</td>
            <td className="py-2 pr-4 text-right">
              {d.assessed} de {d.applicable}
            </td>
            <td className="py-2 text-right">{d.meetingTarget}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Cuántos controles hay en cada nivel 0-4. Los niveles tienen orden, así que la
 * escala es ordinal: un solo tono, de claro (0) a oscuro (4). Cada columna lleva
 * su valor arriba y su nivel abajo: no hace falta eje Y ni leyenda.
 */
export function MaturityColumns({ distribution, target }: { distribution: number[]; target: number }) {
  const [active, setActive] = useState<number | null>(null);
  const total = distribution.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...distribution);

  return (
    <div className="grid gap-2">
      <div className="relative grid h-44 grid-cols-5 items-end border-b" style={{ borderColor: "var(--chart-baseline)" }}>
        {distribution.map((count, level) => {
          const height = (count / max) * 100;
          const show = active === level;
          const info = MATURITY_LEVELS[level]!;
          return (
            <div
              key={level}
              className="relative flex h-full flex-col items-center justify-end outline-none focus-visible:ring-2 focus-visible:ring-ring"
              tabIndex={0}
              aria-label={`Nivel ${level} ${info.label}: ${count} controles`}
              onPointerEnter={() => setActive(level)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(level)}
              onBlur={() => setActive(null)}
            >
              <span aria-hidden className="mb-1 text-xs font-medium tabular-nums text-foreground">
                {count}
              </span>
              <span
                aria-hidden
                className={cn("w-6 rounded-t-[4px] transition-opacity", active !== null && !show && "opacity-60")}
                style={{ height: `${count === 0 ? 0 : Math.max(height * 0.82, 2)}%`, background: `var(--maturity-${level})` }}
              />
              {show && (
                <Tip value={`${count} control${count === 1 ? "" : "es"}`} className="bottom-full mb-1">
                  Nivel {level} · {info.label}
                  {total > 0 && ` · ${formatPercent((count / total) * 100)} de lo evaluado`}
                  {level < target ? " · por debajo del objetivo" : " · alcanza el objetivo"}
                </Tip>
              )}
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-5 text-center text-[11px] sm:text-xs" aria-hidden>
        {MATURITY_LEVELS.map((l) => (
          <span
            key={l.value}
            // min-w-0 + corte de palabra: en pantallas angostas las etiquetas no se pisan entre columnas.
            className={cn(
              "grid min-w-0 gap-0.5 px-0.5 [overflow-wrap:anywhere]",
              l.value === target ? "font-semibold text-foreground" : "text-muted-foreground",
            )}
          >
            <span>{l.value}</span>
            <span className="leading-tight">{l.label}</span>
            {l.value === target && <span className="text-[11px]">(objetivo)</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

export function MaturityTable({ distribution }: { distribution: number[] }) {
  const total = distribution.reduce((a, b) => a + b, 0);
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr className="border-b">
          <th className="py-2 pr-4 font-medium">Nivel</th>
          <th className="py-2 pr-4 text-right font-medium">Controles</th>
          <th className="py-2 text-right font-medium">% de lo evaluado</th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {distribution.map((count, level) => (
          <tr key={level} className="border-b last:border-0">
            <td className="py-2 pr-4">
              {level} · {MATURITY_LEVELS[level]?.label}
            </td>
            <td className="py-2 pr-4 text-right">{count}</td>
            <td className="py-2 text-right">{total ? formatPercent((count / total) * 100) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Medidor de una proporción: la pista es un tono más claro de la misma rampa. */
export function Meter({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className="h-2 w-full overflow-hidden rounded-full"
      style={{ background: "var(--maturity-0)" }}
    >
      <div className="h-full rounded-full" style={{ width: `${clamped}%`, background: "var(--chart-series)" }} />
    </div>
  );
}

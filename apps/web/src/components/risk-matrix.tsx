"use client";

import { useState, type ReactNode } from "react";
import { IMPACT_LEVELS, LIKELIHOOD_LEVELS, RISK_LEVEL_LABEL, riskCode, riskLevel, riskScore } from "@cumplia/core/risk";
import { Tip } from "@/components/charts";
import { RiskLevelBadge } from "@/components/risk-level";
import { cellKey, matrixCells, type MatrixMode } from "@/lib/risk";
import { cn } from "@/lib/utils";
import type { Risk } from "@/lib/types";

/*
 * Mapa de calor 5×5 (probabilidad × impacto). Cada celda muestra cuántos riesgos
 * caen ahí y su nivel escrito; tooltip con mouse y teclado; clic para filtrar.
 * Impacto de mayor (arriba) a menor; probabilidad de menor (izquierda) a mayor.
 */

const IMPACT_DESC = [...IMPACT_LEVELS].reverse();

export function RiskMatrix({
  risks,
  mode,
  selected,
  onSelect,
}: {
  risks: Risk[];
  mode: MatrixMode;
  selected: string | null;
  onSelect: (cell: string | null) => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  const cells = matrixCells(risks, mode);

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 sm:grid-cols-[2rem_minmax(0,1fr)]">
        <div className="flex items-center justify-center" aria-hidden>
          <span className="-rotate-90 whitespace-nowrap text-xs font-medium text-muted-foreground">Impacto</span>
        </div>
        <div className="grid grid-cols-[2.25rem_repeat(5,minmax(0,1fr))] gap-1 sm:grid-cols-[7.5rem_repeat(5,minmax(0,1fr))]">
          {IMPACT_DESC.map((imp) => (
            <Row key={imp.value} label={imp.label} value={imp.value}>
              {LIKELIHOOD_LEVELS.map((lik) => {
                const key = cellKey(lik.value, imp.value);
                const list = cells.get(key) ?? [];
                const score = riskScore(lik.value, imp.value);
                const level = riskLevel(score);
                const isSelected = selected === key;
                const dimmed = selected !== null && !isSelected;
                const count = list.length;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`Probabilidad ${lik.value} ${lik.label}, impacto ${imp.value} ${imp.label}: nivel ${RISK_LEVEL_LABEL[level]} (${score}), ${count} riesgo${count === 1 ? "" : "s"}`}
                    onClick={() => onSelect(isSelected ? null : key)}
                    onPointerEnter={() => setActive(key)}
                    onPointerLeave={() => setActive(null)}
                    onFocus={() => setActive(key)}
                    onBlur={() => setActive(null)}
                    className={cn(
                      "relative grid h-14 place-content-center gap-0.5 rounded-md border border-foreground/5 text-center transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-16",
                      dimmed && "opacity-45",
                      isSelected && "ring-2 ring-foreground",
                    )}
                    style={{ background: `var(--risk-${level})` }}
                  >
                    <span className={cn("text-lg font-semibold tabular-nums leading-none", count === 0 && "text-foreground/35")} aria-hidden>
                      {count === 0 ? "·" : count}
                    </span>
                    <span className="text-[10px] leading-none text-foreground/75 sm:text-[11px]" aria-hidden>
                      {RISK_LEVEL_LABEL[level]}
                    </span>
                    {active === key && (
                      <Tip
                        value={`${count} riesgo${count === 1 ? "" : "s"}`}
                        className={cn(
                          "bottom-full mb-1 text-left",
                          lik.value === 1 ? "left-0" : lik.value === 5 ? "right-0" : "left-1/2 -translate-x-1/2",
                        )}
                      >
                        Nivel {RISK_LEVEL_LABEL[level]} · puntaje {score}
                        <br />
                        Probabilidad {lik.value} ({lik.label}) × impacto {imp.value} ({imp.label})
                        {count > 0 && (
                          <>
                            <br />
                            {list
                              .slice(0, 4)
                              .map((r) => riskCode(r.number))
                              .join(", ")}
                            {count > 4 && ` y ${count - 4} más`}
                          </>
                        )}
                      </Tip>
                    )}
                  </button>
                );
              })}
            </Row>
          ))}
          <div aria-hidden />
          {LIKELIHOOD_LEVELS.map((lik) => (
            <div key={lik.value} className="grid min-w-0 gap-0.5 pt-1 text-center text-[11px] text-muted-foreground sm:text-xs" aria-hidden>
              <span className="font-medium text-foreground">{lik.value}</span>
              <span className="hidden leading-tight [overflow-wrap:anywhere] sm:block">{lik.label}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="text-center text-xs font-medium text-muted-foreground" aria-hidden>
        Probabilidad
      </p>
    </div>
  );
}

function Row({ label, value, children }: { label: string; value: number; children: ReactNode }) {
  return (
    <>
      <div className="flex items-center justify-end pr-1 text-right text-[11px] text-muted-foreground sm:text-xs" aria-hidden>
        <span className="font-medium text-foreground">{value}</span>
        <span className="ml-1 hidden sm:inline">{label}</span>
      </div>
      {children}
    </>
  );
}

/** Equivalente en tabla del mapa de calor: solo las celdas con riesgos. */
export function RiskMatrixTable({ risks, mode }: { risks: Risk[]; mode: MatrixMode }) {
  const rows = [...matrixCells(risks, mode).entries()]
    .map(([key, list]) => {
      const [l, i] = key.split("-").map(Number) as [number, number];
      return { key, l, i, score: riskScore(l, i), list };
    })
    .sort((a, b) => b.score - a.score || b.i - a.i);

  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No hay riesgos para mostrar en esta vista.</p>;
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="py-2 pr-4 font-medium">Probabilidad</th>
            <th className="py-2 pr-4 font-medium">Impacto</th>
            <th className="py-2 pr-4 font-medium">Nivel</th>
            <th className="py-2 pr-4 text-right font-medium">Riesgos</th>
            <th className="py-2 font-medium">Códigos</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b last:border-0">
              <td className="py-2 pr-4">
                {r.l} · {LIKELIHOOD_LEVELS[r.l - 1]?.label}
              </td>
              <td className="py-2 pr-4">
                {r.i} · {IMPACT_LEVELS[r.i - 1]?.label}
              </td>
              <td className="py-2 pr-4">
                <RiskLevelBadge level={riskLevel(r.score)} score={r.score} />
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">{r.list.length}</td>
              <td className="py-2 text-xs text-muted-foreground">{r.list.map((x) => riskCode(x.number)).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

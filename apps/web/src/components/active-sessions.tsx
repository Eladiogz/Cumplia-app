"use client";

import { useCallback, useEffect, useState } from "react";
import { Laptop, LogOut, MonitorSmartphone, Smartphone } from "lucide-react";
import { FormError, FormSuccess, Spinner } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, errorMessage } from "@/lib/api";
import { describeUserAgent, deviceLabel, timeAgo, type ActiveSession } from "@/lib/sessions";

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Dónde está abierta la cuenta (en todas sus organizaciones). Si hay una sesión que
 * no reconocés, cerrala y cambiá la contraseña.
 */
export function ActiveSessions() {
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(() => {
    api<ActiveSession[]>("/auth/sessions")
      .then(setSessions)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const closeOne = async (s: ActiveSession) => {
    setError(null);
    setMessage(null);
    setPending(s.id);
    try {
      await api(`/auth/sessions/${s.id}`, { method: "DELETE" });
      setSessions((list) => list?.filter((x) => x.id !== s.id) ?? null);
      setMessage(`Cerramos la sesión de ${deviceLabel(describeUserAgent(s.userAgent))}.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(null);
    }
  };

  const closeOthers = async () => {
    setError(null);
    setMessage(null);
    setPending("others");
    try {
      const { closed } = await api<{ closed: number }>("/auth/sessions/revoke-others", { method: "POST" });
      setMessage(closed === 0 ? "No había otras sesiones abiertas." : `Cerramos ${closed} sesión${closed === 1 ? "" : "es"}.`);
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(null);
    }
  };

  const others = sessions?.filter((s) => !s.current).length ?? 0;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1.5">
          <CardTitle className="flex items-center gap-2">
            <MonitorSmartphone className="size-4 text-primary" aria-hidden /> Sesiones activas
          </CardTitle>
          <CardDescription>
            Dónde está abierta tu cuenta. Si ves una que no reconocés, cerrala y cambiá tu contraseña.
          </CardDescription>
        </div>
        {others > 0 && (
          <Button variant="outline" size="sm" disabled={pending !== null} onClick={() => void closeOthers()}>
            <LogOut aria-hidden /> Cerrar las demás
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-3">
        <FormError message={error} />
        <FormSuccess message={message} />
        {!sessions ? (
          !error && <Spinner />
        ) : (
          <ul className="divide-y rounded-md border">
            {sessions.map((s) => {
              const device = describeUserAgent(s.userAgent);
              const Icon = device.mobile ? Smartphone : Laptop;
              return (
                <li key={s.id} className="flex flex-wrap items-start gap-3 p-3 sm:flex-nowrap">
                  <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="grid min-w-0 flex-1 gap-0.5 text-sm">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {deviceLabel(device)}
                      {s.current && <Badge variant="success">Esta sesión</Badge>}
                    </span>
                    <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {s.organizationName}
                      {s.ipAddress && ` · IP ${s.ipAddress}`}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {s.current ? "Activa ahora" : `Última actividad ${timeAgo(s.lastSeenAt)}`} · Inició el {formatDateTime(s.createdAt)}
                    </span>
                  </div>
                  {!s.current && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-8 sm:ml-0"
                      disabled={pending !== null}
                      onClick={() => void closeOne(s)}
                      aria-label={`Cerrar la sesión de ${deviceLabel(device)} en ${s.organizationName}`}
                    >
                      {pending === s.id ? "Cerrando…" : "Cerrar"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

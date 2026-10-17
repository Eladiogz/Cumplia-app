"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ClipboardList, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { ROLE_DESCRIPTION, ROLE_LABEL, canManageMembers } from "@/lib/roles";
import { useMe } from "@/lib/session";
import type { Assessment } from "@/lib/types";

export default function HomePage() {
  const { me, organizations } = useMe();
  const organization = organizations.find((o) => o.active);
  const [assessments, setAssessments] = useState<Assessment[] | null>(null);

  useEffect(() => {
    api<Assessment[]>("/assessments")
      .then(setAssessments)
      .catch(() => setAssessments([]));
  }, []);

  const firstName = me.user.name?.split(" ")[0];
  return (
    <>
      <PageHeader
        title={firstName ? `Hola, ${firstName}` : "Inicio"}
        description={`${organization?.organizationName ?? ""} · ${ROLE_LABEL[me.role]}`}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="size-4 text-primary" aria-hidden /> Evaluaciones
            </CardTitle>
            <CardDescription>Gap assessment frente a ISO/IEC 27001:2022.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p>
              {assessments === null
                ? "Cargando…"
                : assessments.length === 0
                  ? "Todavía no hay evaluaciones en esta organización."
                  : `${assessments.length} evaluación${assessments.length === 1 ? "" : "es"} en curso.`}
            </p>
            <Button asChild variant={assessments?.length ? "outline" : "default"} size="sm" className="w-fit">
              <Link href="/evaluaciones">
                {assessments?.length ? "Ver evaluaciones" : "Empezar una evaluación"} <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {me.mfaEnabled ? (
                <ShieldCheck className="size-4 text-success" aria-hidden />
              ) : (
                <ShieldAlert className="size-4 text-warning" aria-hidden />
              )}
              Verificación en dos pasos
            </CardTitle>
            <CardDescription>
              {me.mfaEnabled
                ? "Activa: tu cuenta está protegida aunque alguien sepa tu contraseña."
                : "Desactivada: te recomendamos activarla, lleva un minuto."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant={me.mfaEnabled ? "outline" : "default"} size="sm">
              <Link href="/seguridad">
                {me.mfaEnabled ? "Ver seguridad" : "Activar ahora"} <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4 text-primary" aria-hidden /> Tu rol: {ROLE_LABEL[me.role]}
            </CardTitle>
            <CardDescription>{ROLE_DESCRIPTION[me.role]}</CardDescription>
          </CardHeader>
          {canManageMembers(me.role) && (
            <CardContent>
              <Button asChild variant="outline" size="sm">
                <Link href="/organizacion">
                  Invitar a tu equipo <ArrowRight aria-hidden />
                </Link>
              </Button>
            </CardContent>
          )}
        </Card>
      </div>
    </>
  );
}

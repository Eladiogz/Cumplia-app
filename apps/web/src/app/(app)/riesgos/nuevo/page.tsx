"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { FormError, Spinner } from "@/components/form";
import { PageHeader } from "@/components/page-header";
import { RiskForm } from "@/components/risk-form";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { RISK_FRAMEWORK } from "@/lib/risk";
import { canEditRisks } from "@/lib/roles";
import { useMe } from "@/lib/session";
import type { Framework, Risk, RiskOwner } from "@/lib/types";

export default function NewRiskPage() {
  const router = useRouter();
  const { me } = useMe();
  const [owners, setOwners] = useState<RiskOwner[] | null>(null);
  const [framework, setFramework] = useState<Framework | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = canEditRisks(me.role);

  useEffect(() => {
    if (!canEdit) return;
    Promise.all([api<RiskOwner[]>("/risks/owners"), api<Framework>(`/frameworks/${RISK_FRAMEWORK}`)])
      .then(([o, fw]) => {
        setOwners(o);
        setFramework(fw);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [canEdit]);

  return (
    <>
      <Link href="/riesgos" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Riesgos
      </Link>
      <PageHeader title="Nuevo riesgo" description="Se numera solo (R-001, R-002…). Podés completar el tratamiento y el residual más adelante." />
      {!canEdit ? (
        <FormError message="Tu rol puede ver los riesgos, pero no registrarlos." />
      ) : !owners || !framework ? (
        error ? <FormError message={error} /> : <Spinner />
      ) : (
        <RiskForm
          owners={owners}
          controls={framework.controls}
          submitLabel="Registrar riesgo"
          onSubmit={async (payload) => {
            await api<Risk>("/risks", { body: payload });
            router.push("/riesgos");
          }}
          footer={
            <Button asChild variant="ghost">
              <Link href="/riesgos">Cancelar</Link>
            </Button>
          }
        />
      )}
    </>
  );
}

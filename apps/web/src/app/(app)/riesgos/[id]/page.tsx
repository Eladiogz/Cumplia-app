"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { riskCode } from "@cumplia/core/risk";
import { FormError, Spinner } from "@/components/form";
import { PageHeader } from "@/components/page-header";
import { RiskForm } from "@/components/risk-form";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { RISK_FRAMEWORK } from "@/lib/risk";
import { canDeleteRisks, canEditRisks } from "@/lib/roles";
import { useMe } from "@/lib/session";
import type { Framework, Risk, RiskOwner } from "@/lib/types";

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function RiskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { me } = useMe();
  const canEdit = canEditRisks(me.role);
  const canDelete = canDeleteRisks(me.role);
  const [risk, setRisk] = useState<Risk | null>(null);
  const [owners, setOwners] = useState<RiskOwner[]>([]);
  const [framework, setFramework] = useState<Framework | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [r, fw, o] = await Promise.all([
          api<Risk>(`/risks/${id}`),
          api<Framework>(`/frameworks/${RISK_FRAMEWORK}`),
          // Solo quien edita puede listar a quién asignar.
          canEdit ? api<RiskOwner[]>("/risks/owners") : Promise.resolve([]),
        ]);
        setRisk(r);
        setFramework(fw);
        setOwners(o);
      } catch (e) {
        setError(errorMessage(e));
      }
    })();
  }, [id, canEdit]);

  const remove = async () => {
    setDeleteError(null);
    try {
      await api(`/risks/${id}`, { method: "DELETE" });
      router.push("/riesgos");
    } catch (e) {
      setDeleteError(errorMessage(e));
    }
  };

  return (
    <>
      <Link href="/riesgos" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Riesgos
      </Link>
      {error ? (
        <FormError message={error} />
      ) : !risk || !framework ? (
        <Spinner />
      ) : (
        <>
          <PageHeader
            title={`${riskCode(risk.number)} · ${risk.title}`}
            description={`Registrado el ${formatDateTime(risk.createdAt)} · última actualización ${formatDateTime(risk.updatedAt)}`}
          />
          <RiskForm
            initial={risk}
            owners={owners}
            controls={framework.controls}
            readOnly={!canEdit}
            submitLabel="Guardar cambios"
            onSubmit={async (payload) => {
              setRisk(await api<Risk>(`/risks/${id}`, { method: "PATCH", body: payload }));
            }}
            footer={
              canDelete && (
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {deleteError && <span className="text-sm text-destructive">{deleteError}</span>}
                  {confirming ? (
                    <>
                      <span className="text-sm">¿Borrar este riesgo? Queda registrado en la auditoría.</span>
                      <Button type="button" variant="destructive" onClick={() => void remove()}>
                        Borrar
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <Button type="button" variant="ghost" className="text-destructive" onClick={() => setConfirming(true)}>
                      <Trash2 aria-hidden /> Borrar riesgo
                    </Button>
                  )}
                </div>
              )
            }
          />
        </>
      )}
    </>
  );
}

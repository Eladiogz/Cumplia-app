"use client";

import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMe } from "@/lib/session";

/**
 * Descarga de la Declaración de Aplicabilidad. Son links comunes a la API (mismo
 * origen: la cookie de sesión viaja sola); la API verifica permisos y lo audita.
 */
export function SoaExportMenu({ assessmentId, size = "sm" }: { assessmentId: string; size?: "sm" | "default" }) {
  const { me } = useMe();
  if (!me.emailVerified) {
    return (
      <Button variant="outline" size={size} disabled title="Confirmá tu email para exportar">
        <Download aria-hidden /> Exportar SoA
      </Button>
    );
  }
  const base = `/api/assessments/${assessmentId}/soa`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size}>
          <Download aria-hidden /> Exportar SoA
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Declaración de Aplicabilidad</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <a href={`${base}.pdf`} download>
            <FileText aria-hidden /> PDF (para firmar y presentar)
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`${base}.xlsx`} download>
            <FileSpreadsheet aria-hidden /> Excel (para trabajar y filtrar)
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

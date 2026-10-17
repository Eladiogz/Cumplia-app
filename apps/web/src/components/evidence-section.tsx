"use client";

import { useRef, useState, type FormEvent } from "react";
import { ExternalLink, FileText, Fingerprint, Link2, Paperclip, Trash2, Upload, X } from "lucide-react";
import { FormError } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { ACCEPT_ATTRIBUTE, fileProblem, formatBytes, linkify } from "@/lib/evidence";
import { cn } from "@/lib/utils";
import type { Evidence } from "@/lib/types";

const NOT_STORED = "Para adjuntar evidencia, primero completá la respuesta (si no aplica, escribí la justificación).";

/**
 * Evidencia de un control: notas o links, y archivos (capturas, fotos, PDFs).
 * Los archivos se ven y descargan siempre a través de la API, que verifica permisos.
 */
export function EvidenceSection({
  controlId,
  assessmentId,
  evidence,
  readOnly,
  ensureStored,
  onAdded,
  onDeleted,
}: {
  controlId: string;
  assessmentId: string;
  evidence: Evidence[];
  readOnly: boolean;
  /** Guarda la respuesta del control si todavía no existe (la evidencia se cuelga de ella). */
  ensureStored: () => Promise<boolean>;
  onAdded: (ev: Evidence) => void;
  onDeleted: (evidenceId: string) => void;
}) {
  const [mode, setMode] = useState<"note" | "file">("note");

  return (
    <div className="grid gap-3">
      <span className="text-sm font-medium">Evidencia</span>
      {evidence.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin evidencia registrada.</p>
      ) : (
        <ul className="grid gap-2">
          {evidence.map((ev) => (
            <EvidenceItem key={ev.id} ev={ev} assessmentId={assessmentId} readOnly={readOnly} onDeleted={onDeleted} />
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className="grid gap-2 rounded-md border border-dashed p-3">
          <div className="flex gap-1" role="tablist" aria-label="Tipo de evidencia">
            {(
              [
                ["note", "Nota o link", Link2],
                ["file", "Archivo", Paperclip],
              ] as const
            ).map(([value, label, Icon]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                role="tab"
                aria-selected={mode === value}
                variant={mode === value ? "secondary" : "ghost"}
                onClick={() => setMode(value)}
              >
                <Icon aria-hidden /> {label}
              </Button>
            ))}
          </div>
          {mode === "note" ? (
            <NoteForm controlId={controlId} assessmentId={assessmentId} ensureStored={ensureStored} onAdded={onAdded} />
          ) : (
            <FileForm controlId={controlId} assessmentId={assessmentId} ensureStored={ensureStored} onAdded={onAdded} />
          )}
        </div>
      )}
    </div>
  );
}

function EvidenceItem({
  ev,
  assessmentId,
  readOnly,
  onDeleted,
}: {
  ev: Evidence;
  assessmentId: string;
  readOnly: boolean;
  onDeleted: (evidenceId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileUrl = `/api/assessments/${assessmentId}/evidence/${ev.id}/file`;
  const isImage = ev.contentType?.startsWith("image/");
  const isFile = ev.fileName !== null;

  const remove = async () => {
    setError(null);
    try {
      await api(`/assessments/${assessmentId}/evidence/${ev.id}`, { method: "DELETE" });
      onDeleted(ev.id);
    } catch (e) {
      setError(errorMessage(e));
      setConfirming(false);
    }
  };

  return (
    <li className="grid gap-1 rounded-md bg-muted p-2.5 text-sm">
      <div className="flex items-start gap-3">
        {isFile && isImage ? (
          <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="shrink-0" aria-label={`Abrir ${ev.fileName}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- la imagen viene de la API con la cookie de sesión */}
            <img src={fileUrl} alt={ev.description} loading="lazy" className="size-16 rounded border bg-card object-cover" />
          </a>
        ) : (
          <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="break-words">
            {linkify(ev.description).map((part, i) =>
              "href" in part ? (
                <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                  {part.text}
                </a>
              ) : (
                <span key={i}>{part.text}</span>
              ),
            )}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {isFile && (
              <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                <ExternalLink className="size-3" aria-hidden /> {ev.fileName}
              </a>
            )}
            {ev.fileSize !== null && <span>{formatBytes(ev.fileSize)}</span>}
            <span>{new Date(ev.collectedAt).toLocaleDateString("es-AR")}</span>
            {ev.sha256 && (
              <span className="inline-flex items-center gap-1" title={`Huella SHA-256 (prueba de que el archivo no cambió): ${ev.sha256}`}>
                <Fingerprint className="size-3" aria-hidden /> {ev.sha256.slice(0, 12)}…
              </span>
            )}
          </p>
        </div>
        {!readOnly &&
          (confirming ? (
            <span className="inline-flex shrink-0 gap-1">
              <Button size="sm" variant="destructive" onClick={() => void remove()}>
                Borrar
              </Button>
              <Button size="icon" variant="ghost" onClick={() => setConfirming(false)} aria-label="Cancelar">
                <X aria-hidden />
              </Button>
            </span>
          ) : (
            <Button size="icon" variant="ghost" className="shrink-0" onClick={() => setConfirming(true)} aria-label="Borrar evidencia">
              <Trash2 aria-hidden />
            </Button>
          ))}
      </div>
      <FormError message={error} />
    </li>
  );
}

interface FormProps {
  controlId: string;
  assessmentId: string;
  ensureStored: () => Promise<boolean>;
  onAdded: (ev: Evidence) => void;
}

function NoteForm({ controlId, assessmentId, ensureStored, onAdded }: FormProps) {
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (!(await ensureStored())) return setError(NOT_STORED);
      onAdded(await api<Evidence>(`/assessments/${assessmentId}/evidence`, { body: { controlId, source: "manual", description: description.trim() } }));
      setDescription("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={add} className="grid gap-2">
      <FormError message={error} />
      <div className="flex gap-2">
        <Input
          aria-label="Nota o link de la evidencia"
          placeholder="Ej.: Política de accesos v2 aprobada en marzo — https://intranet/politica-accesos"
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={pending || !description.trim()}>
          Agregar
        </Button>
      </div>
    </form>
  );
}

function FileForm({ controlId, assessmentId, ensureStored, onAdded }: FormProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [dragging, setDragging] = useState(false);

  const choose = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    const problem = fileProblem(f);
    if (problem) {
      setFile(null);
      setError(problem);
      return;
    }
    setFile(f);
  };

  const upload = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setPending(true);
    try {
      if (!(await ensureStored())) return setError(NOT_STORED);
      // Los campos van ANTES del archivo: la API los lee al llegar al archivo.
      const form = new FormData();
      form.append("controlId", controlId);
      if (description.trim()) form.append("description", description.trim());
      form.append("file", file);
      onAdded(await api<Evidence>(`/assessments/${assessmentId}/evidence/files`, { body: form }));
      setFile(null);
      setDescription("");
      if (inputRef.current) inputRef.current.value = "";
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={upload} className="grid gap-2">
      <FormError message={error} />
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          choose(e.dataTransfer.files[0]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed bg-card px-3 py-4 text-center text-sm text-muted-foreground transition-colors hover:bg-accent",
          dragging && "border-primary bg-accent",
        )}
      >
        <Upload className="size-5" aria-hidden />
        {file ? (
          <span className="text-foreground">
            {file.name} · {formatBytes(file.size)}
          </span>
        ) : (
          <span>Arrastrá una captura, foto o PDF, o hacé clic para elegirla</span>
        )}
        <span className="text-xs">PNG, JPG, WebP o PDF · hasta 10 MB</span>
        <input ref={inputRef} type="file" accept={ACCEPT_ATTRIBUTE} className="sr-only" onChange={(e) => choose(e.target.files?.[0])} />
      </label>
      <div className="flex gap-2">
        <Input
          aria-label="Descripción del archivo (opcional)"
          placeholder="Descripción (opcional): qué muestra y de cuándo es"
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Button type="submit" disabled={pending || !file}>
          {pending ? "Subiendo…" : "Subir"}
        </Button>
      </div>
    </form>
  );
}

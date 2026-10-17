"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { KeyRound, LogOut, MailPlus, MoreHorizontal, ShieldCheck, ShieldOff, Trash2, X } from "lucide-react";
import { Field, FormError, FormSuccess, Spinner } from "@/components/form";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input, NativeSelect } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { ROLE_DESCRIPTION, ROLE_LABEL, canManageMembers, canSeeMembers } from "@/lib/roles";
import { useMe } from "@/lib/session";
import type { Invitation, Member, Organization, Role } from "@/lib/types";

const ROLES: Role[] = ["ADMIN", "CONSULTANT", "AUDITOR"];
const formatDate = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });

export default function OrganizationPage() {
  const { me } = useMe();
  return (
    <>
      <PageHeader title="Organización" description="Datos, políticas de seguridad y quiénes tienen acceso." />
      <div className="grid gap-4">
        <OrganizationSettings />
        {canSeeMembers(me.role) ? (
          <>
            <Members />
            <Invitations />
          </>
        ) : (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              La gestión de miembros e invitaciones está a cargo de los administradores de la organización.
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

function OrganizationSettings() {
  const { me, refresh } = useMe();
  const isAdmin = canManageMembers(me.role);
  const [org, setOrg] = useState<Organization | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api<Organization>("/organization")
      .then((o) => {
        setOrg(o);
        setName(o.name);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  const save = async (changes: Partial<Pick<Organization, "name" | "requireMfa">>, message: string) => {
    setError(null);
    setSuccess(null);
    setPending(true);
    try {
      setOrg(await api<Organization>("/organization", { method: "PATCH", body: changes }));
      setSuccess(message);
      await refresh(); // el nombre aparece en el selector de organización
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  const rename = (e: FormEvent) => {
    e.preventDefault();
    void save({ name: name.trim() }, "Guardamos el nombre de la organización.");
  };

  if (!org) {
    return (
      <Card>
        <CardContent className="py-6">{error ? <FormError message={error} /> : <Spinner />}</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Datos y políticas</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6">
        <FormError message={error} />
        <FormSuccess message={success} />
        <form onSubmit={rename} className="flex flex-wrap items-end gap-3">
          <Field id="org-name" label="Nombre">
            <Input id="org-name" className="w-72" minLength={2} maxLength={120} required disabled={!isAdmin} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {isAdmin && (
            <Button type="submit" variant="outline" disabled={pending || name.trim() === org.name}>
              Guardar
            </Button>
          )}
        </form>

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border p-4">
          <div className="grid gap-1">
            <p className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="size-4 text-primary" aria-hidden /> Exigir verificación en dos pasos
              {org.requireMfa ? <Badge variant="success">Activo</Badge> : <Badge variant="secondary">No exigido</Badge>}
            </p>
            <p className="text-sm text-muted-foreground">
              Todos los miembros deberán activar MFA antes de operar. Recomendado para cumplir ISO 27001 (A.5.17 y A.8.5).
            </p>
          </div>
          {isAdmin && (
            <Button
              variant={org.requireMfa ? "outline" : "default"}
              disabled={pending}
              onClick={() =>
                void save(
                  { requireMfa: !org.requireMfa },
                  org.requireMfa ? "MFA ya no es obligatorio." : "Listo: MFA es obligatorio para todos los miembros.",
                )
              }
            >
              {org.requireMfa ? "Dejar de exigir" : "Exigir MFA"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Members() {
  const { me, refresh } = useMe();
  const isAdmin = canManageMembers(me.role);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Member[]>("/members")
      .then(setMembers)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const changeRole = async (userId: string, role: Role) => {
    setError(null);
    try {
      await api(`/members/${userId}`, { method: "PATCH", body: { role } });
      // Si me cambié el rol a mí mismo, la interfaz se adapta (puedo dejar de ser ADMIN).
      if (userId === me.user.id) return await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
    load();
  };

  const remove = async (userId: string) => {
    setError(null);
    setConfirmRemove(null);
    try {
      await api(`/members/${userId}`, { method: "DELETE" });
    } catch (e) {
      setError(errorMessage(e));
    }
    load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Miembros</CardTitle>
        <CardDescription>Quiénes acceden a esta organización y con qué rol. Los cambios rigen al instante.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <FormError message={error} />
        <FormSuccess message={success} />
        {!members ? (
          <Spinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-4 font-medium">Persona</th>
                  <th className="py-2 pr-4 font-medium">Rol</th>
                  <th className="py-2 pr-4 font-medium">MFA</th>
                  {isAdmin && <th className="py-2 font-medium" aria-label="Acciones" />}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const isMe = m.userId === me.user.id;
                  return (
                    <tr key={m.userId} className="border-b last:border-0">
                      <td className="py-3 pr-4">
                        <div className="font-medium">
                          {m.name ?? m.email} {isMe && <span className="text-muted-foreground">(vos)</span>}
                        </div>
                        {m.name && <div className="text-xs text-muted-foreground">{m.email}</div>}
                      </td>
                      <td className="py-3 pr-4">
                        {isAdmin ? (
                          <NativeSelect
                            aria-label={`Rol de ${m.email}`}
                            className="w-44"
                            value={m.role}
                            onChange={(e) => void changeRole(m.userId, e.target.value as Role)}
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABEL[r]}
                              </option>
                            ))}
                          </NativeSelect>
                        ) : (
                          ROLE_LABEL[m.role]
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        {m.mfaEnabled ? <Badge variant="success">Activo</Badge> : <Badge variant="warning">Sin MFA</Badge>}
                      </td>
                      {isAdmin && (
                        <td className="py-3 text-right">
                          {!isMe &&
                            (confirmRemove === m.userId ? (
                              <span className="inline-flex gap-1">
                                <Button size="sm" variant="destructive" onClick={() => void remove(m.userId)}>
                                  Quitar acceso
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(null)} aria-label="Cancelar">
                                  <X aria-hidden />
                                </Button>
                              </span>
                            ) : (
                              <MemberActions
                                member={m}
                                onRemove={() => setConfirmRemove(m.userId)}
                                onResult={(message, ok) => {
                                  setError(ok ? null : message);
                                  setSuccess(ok ? message : null);
                                  load();
                                }}
                              />
                            ))}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Ayuda a un miembro con su cuenta sin tocar nunca su contraseña. Restablecer el MFA
 * solo funciona si la cuenta es exclusiva de esta organización (la API lo verifica).
 */
function MemberActions({
  member,
  onRemove,
  onResult,
}: {
  member: Member;
  onRemove: () => void;
  onResult: (message: string, ok: boolean) => void;
}) {
  const run = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      onResult(message, true);
    } catch (e) {
      onResult(errorMessage(e), false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={`Acciones para ${member.email}`}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{member.email}</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() =>
            void run(
              () => api(`/members/${member.userId}/password-reset`, { body: {} }),
              `Le enviamos a ${member.email} un link para elegir una contraseña nueva.`,
            )
          }
        >
          <KeyRound aria-hidden /> Enviar link para restablecer la contraseña
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            void run(
              () => api(`/members/${member.userId}/sessions/revoke`, { body: {} }),
              `Cerramos las sesiones de ${member.email} en esta organización.`,
            )
          }
        >
          <LogOut aria-hidden /> Cerrar sus sesiones
        </DropdownMenuItem>
        {member.mfaEnabled && (
          <DropdownMenuItem
            onSelect={() =>
              void run(
                () => api(`/members/${member.userId}/mfa`, { method: "DELETE" }),
                `Restablecimos el MFA de ${member.email}. Le avisamos por email.`,
              )
            }
          >
            <ShieldOff aria-hidden /> Restablecer su MFA
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onRemove}>
          <Trash2 aria-hidden /> Quitar de la organización
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Invitations() {
  const { me } = useMe();
  const isAdmin = canManageMembers(me.role);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("CONSULTANT");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(() => {
    api<Invitation[]>("/invitations")
      .then(setInvitations)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setPending(true);
    try {
      const inv = await api<Invitation>("/invitations", { body: { email, role } });
      setSuccess(`Enviamos la invitación a ${inv.email}. Vence en 7 días.`);
      setEmail("");
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const revoke = async (id: string) => {
    setError(null);
    try {
      await api(`/invitations/${id}`, { method: "DELETE" });
    } catch (e) {
      setError(errorMessage(e));
    }
    load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invitaciones</CardTitle>
        <CardDescription>El link viaja solo por email: así sabemos que la persona controla esa casilla.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <FormError message={error} />
        <FormSuccess message={success} />
        {isAdmin && (
          <form onSubmit={invite} className="grid gap-3 rounded-md border p-4 md:grid-cols-[1fr_12rem_auto] md:items-end">
            <Field id="invite-email" label="Email">
              <Input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field id="invite-role" label="Rol">
              <NativeSelect id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Button type="submit" disabled={pending || !me.emailVerified}>
              <MailPlus aria-hidden /> {pending ? "Enviando…" : "Invitar"}
            </Button>
            <p className="text-xs text-muted-foreground md:col-span-3">
              {me.emailVerified ? ROLE_DESCRIPTION[role] : "Para invitar, primero confirmá tu email (revisá tu casilla)."}
            </p>
          </form>
        )}
        {!invitations ? (
          <Spinner />
        ) : invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay invitaciones pendientes.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div>
                  <div className="font-medium">{inv.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {ROLE_LABEL[inv.role]} · vence el {formatDate(inv.expiresAt)}
                  </div>
                </div>
                {isAdmin && (
                  <Button size="sm" variant="ghost" onClick={() => void revoke(inv.id)}>
                    Revocar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

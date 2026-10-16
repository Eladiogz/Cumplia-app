import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { ConflictError, pending, setTenantContext, type Tx } from "./repository.js";
import { auditLogs, invitations, memberships, organizations, users } from "./schema.js";

/**
 * Habilita, solo en esta transacción, la política RLS que deja leer la invitación
 * cuyo token se presenta. Tener el token es la autorización para verla.
 */
async function presentInvitationToken(tx: Tx, tokenHash: string) {
  await tx.execute(sql`select set_config('app.invitation_token_hash', ${tokenHash}, true)`);
}

/** Invitación pendiente y vigente para ese token, con el nombre de la organización. */
async function pendingByToken(tx: Tx, tokenHash: string) {
  await presentInvitationToken(tx, tokenHash);
  const [row] = await tx
    .select({
      id: invitations.id,
      organizationId: invitations.organizationId,
      organizationName: organizations.name,
      email: invitations.email,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
    .where(and(eq(invitations.tokenHash, tokenHash), pending, gt(invitations.expiresAt, sql`now()`)));
  return row ?? null;
}

export type PendingInvitation = NonNullable<Awaited<ReturnType<typeof pendingByToken>>>;

/** Para mostrar "Te invitaron a X como Y" antes de aceptar. */
export function findInvitationByToken(db: Db, tokenHash: string) {
  return db.transaction((tx) => pendingByToken(tx, tokenHash));
}

/**
 * Canjea la invitación para `userId` dentro de la transacción: bloquea la fila
 * (dos aceptaciones simultáneas no pueden ganar ambas), crea la membresía y audita.
 */
async function redeem(tx: Tx, tokenHash: string, userId: string) {
  const inv = await pendingByToken(tx, tokenHash);
  if (!inv) return null;
  // A partir de acá, la organización es conocida: el resto corre con su contexto RLS.
  await setTenantContext(tx, inv.organizationId);
  const [locked] = await tx
    .select({ id: invitations.id })
    .from(invitations)
    .where(and(eq(invitations.id, inv.id), pending))
    .for("update");
  if (!locked) return null;

  const [existing] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.organizationId, inv.organizationId)));
  if (existing) throw new ConflictError("Ya sos miembro de esa organización");

  await tx.insert(memberships).values({ userId, organizationId: inv.organizationId, role: inv.role });
  await tx.update(invitations).set({ acceptedAt: sql`now()`, acceptedBy: userId }).where(eq(invitations.id, inv.id));
  await tx.insert(auditLogs).values({
    organizationId: inv.organizationId,
    actorId: userId,
    action: "invitation.accept",
    entity: "invitation",
    entityId: inv.id,
    details: { email: inv.email, role: inv.role },
  });
  return inv;
}

/**
 * Un usuario existente (ya autenticado) acepta la invitación. El email de la
 * invitación debe ser el suyo: un link reenviado no sirve para otra cuenta.
 */
export async function acceptInvitation(db: Db, input: { tokenHash: string; userId: string; userEmail: string }) {
  return db.transaction(async (tx) => {
    const preview = await pendingByToken(tx, input.tokenHash);
    if (!preview) return { status: "invalid" as const };
    if (preview.email !== input.userEmail) return { status: "wrong_account" as const };
    const inv = await redeem(tx, input.tokenHash, input.userId);
    return inv ? { status: "accepted" as const, invitation: inv } : { status: "invalid" as const };
  });
}

/** Alta de una cuenta nueva desde una invitación: el email lo fija la invitación. */
export async function registerFromInvitation(db: Db, input: { tokenHash: string; passwordHash: string; name?: string }) {
  try {
    return await db.transaction(async (tx) => {
      const preview = await pendingByToken(tx, input.tokenHash);
      if (!preview) return null;
      const [user] = await tx
        .insert(users)
        .values({ email: preview.email, name: input.name ?? null, passwordHash: input.passwordHash })
        .returning();
      if (!user) throw new Error("No se pudo crear el usuario");
      const inv = await redeem(tx, input.tokenHash, user.id);
      if (!inv) throw new Error("La invitación dejó de ser válida");
      // redeem ya fijó el contexto RLS de la organización en esta transacción.
      await tx
        .insert(auditLogs)
        .values({ organizationId: inv.organizationId, actorId: user.id, action: "user.register", entity: "user", entityId: user.id });
      return { user, invitation: inv };
    });
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    if (err?.code === "23505" || err?.cause?.code === "23505") {
      throw new ConflictError("Ya existe una cuenta con ese email: iniciá sesión para aceptar la invitación");
    }
    throw e;
  }
}

/** Organizaciones a las que pertenece el usuario (para elegir la activa). */
export function listMembershipsForUser(db: Db, userId: string) {
  return db
    .select({
      organizationId: organizations.id,
      organizationName: organizations.name,
      role: memberships.role,
      requireMfa: organizations.requireMfa,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(organizations.name));
}

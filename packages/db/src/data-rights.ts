import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { ConflictError } from "./errors.js";
import { setTenantContext } from "./repository.js";
import { auditLogs, memberships, organizations, users } from "./schema.js";

/** Cambia el nombre propio y lo registra en la auditoría de cada organización. */
export async function updateUserName(db: Db, userId: string, name: string) {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .update(users)
      .set({ name })
      .where(eq(users.id, userId))
      .returning({ id: users.id, email: users.email, name: users.name });
    if (!user) throw new Error("Cuenta inexistente");
    const orgs = await tx.select({ id: memberships.organizationId }).from(memberships).where(eq(memberships.userId, userId));
    for (const { id } of orgs) {
      await setTenantContext(tx, id);
      await tx.insert(auditLogs).values({ organizationId: id, actorId: userId, action: "user.name_changed", entity: "user", entityId: userId });
    }
    return user;
  });
}

/**
 * Elimina la cuenta: sus membresías, sesiones, tokens y MFA se borran en cascada.
 * Nunca deja una organización sin ADMIN: si la persona es la única, hay que nombrar
 * a otra o eliminar la organización antes. En la auditoría de cada organización queda
 * el evento (con el id, ya sin datos personales asociados).
 */
export async function deleteUserAccount(db: Db, userId: string) {
  return db.transaction(async (tx) => {
    const mine = await tx
      .select({ organizationId: memberships.organizationId, organizationName: organizations.name, role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(eq(memberships.userId, userId));

    const adminOf = mine.filter((m) => m.role === "ADMIN").map((m) => m.organizationId);
    if (adminOf.length > 0) {
      // Se bloquean todas las membresías de esas organizaciones: un cambio de rol o una
      // baja simultáneos esperan, y el conteo de abajo no queda viejo.
      const others = await tx
        .select({ organizationId: memberships.organizationId, role: memberships.role })
        .from(memberships)
        .where(and(inArray(memberships.organizationId, adminOf), sql`${memberships.userId} <> ${userId}`))
        .for("update");
      const blockers = mine
        .filter((m) => m.role === "ADMIN")
        .filter((m) => !others.some((o) => o.organizationId === m.organizationId && o.role === "ADMIN"))
        .map((m) => {
          const hasMembers = others.some((o) => o.organizationId === m.organizationId);
          return hasMembers
            ? `sos el único ADMIN de «${m.organizationName}»: nombrá a otra persona como ADMIN`
            : `«${m.organizationName}» quedaría sin nadie: eliminá la organización (podés exportar sus datos antes)`;
        });
      if (blockers.length > 0) throw new ConflictError(`No se puede eliminar tu cuenta: ${blockers.join("; ")}.`);
    }

    for (const m of mine) {
      await setTenantContext(tx, m.organizationId);
      await tx.insert(auditLogs).values({
        organizationId: m.organizationId,
        actorId: userId,
        action: "user.account_deleted",
        entity: "user",
        entityId: userId,
        details: { role: m.role },
      });
    }
    await tx.delete(users).where(eq(users.id, userId));
    return mine.map((m) => ({ organizationId: m.organizationId, organizationName: m.organizationName }));
  });
}

"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, api, errorMessage } from "./api";
import type { Me, OrganizationMembership } from "./types";

type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "error"; message: string }
  | { status: "authenticated"; me: Me; organizations: OrganizationMembership[] };

interface SessionContextValue {
  state: SessionState;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Carga quién es el usuario, su organización activa y sus otras organizaciones. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const [me, organizations] = await Promise.all([
        api<Me>("/auth/me"),
        api<OrganizationMembership[]>("/auth/organizations"),
      ]);
      setState({ status: "authenticated", me, organizations });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState({ status: "anonymous" });
      else setState({ status: "error", message: errorMessage(e) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <SessionContext.Provider value={{ state, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession fuera de SessionProvider");
  return ctx;
}

/** Para páginas dentro del área autenticada (el layout ya garantiza la sesión). */
export function useMe() {
  const { state, refresh } = useSession();
  if (state.status !== "authenticated") throw new Error("useMe sin sesión");
  return { ...state, refresh };
}

/** Cierra la sesión y vuelve al ingreso (recarga completa: no queda nada en memoria). */
export async function logout() {
  await api("/auth/logout", { method: "POST" }).catch(() => undefined);
  window.location.assign("/ingresar");
}

/**
 * Cambia de organización activa. Recarga la página entera a propósito: ningún dato
 * de la organización anterior queda en memoria del navegador.
 */
export async function switchOrganization(organizationId: string) {
  await api("/auth/switch-organization", { body: { organizationId } });
  window.location.assign("/");
}

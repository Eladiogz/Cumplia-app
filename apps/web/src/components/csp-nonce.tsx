"use client";

import { setNonce } from "get-nonce";

/**
 * Los menús de Radix agregan un <style> al abrirse (para bloquear el scroll). Con la
 * CSP, ese <style> necesita el nonce de esta respuesta: se lo pasamos acá, antes de
 * que se abra cualquier menú.
 */
export function CspNonce({ nonce }: { nonce: string | null }) {
  if (nonce && typeof window !== "undefined") setNonce(nonce);
  return null;
}

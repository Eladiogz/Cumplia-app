import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE = "cumplia_session";
export const SESSION_DAYS = 7;

/** Token aleatorio de 256 bits que viaja en la cookie. */
export const newSessionToken = () => randomBytes(32).toString("base64url");

/** Lo único que se guarda en la base. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const sessionExpiry = () => new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

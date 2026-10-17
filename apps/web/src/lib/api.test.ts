import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";

const respond = (status: number, body?: unknown) =>
  vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: body === undefined ? {} : { "content-type": "application/json" },
    }),
  );

afterEach(() => vi.unstubAllGlobals());

/** El error con que falla la llamada (y si no falla, el test falla). */
const failure = (call: Promise<unknown>): Promise<ApiError> =>
  call.then(
    () => {
      throw new Error("La llamada no falló");
    },
    (e: ApiError) => e,
  );

describe("cliente de la API", () => {
  it("usa el proxy /api, mismo origen, y solo manda JSON cuando hay cuerpo", async () => {
    const fetchMock = respond(200, { ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await api("/auth/me");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/auth/me", expect.objectContaining({ method: "GET", credentials: "same-origin" }));
    expect(fetchMock.mock.lastCall?.[1].headers).toBeUndefined();

    await api("/auth/login", { body: { email: "a@b.com" } });
    const init = fetchMock.mock.lastCall?.[1];
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(init.body).toBe('{"email":"a@b.com"}');
  });

  it("manda FormData tal cual, sin content-type (lo arma el navegador con el separador)", async () => {
    const fetchMock = respond(201, { id: "x" });
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.append("controlId", "A.5.1");
    await api("/assessments/1/evidence/files", { body: form });
    const init = fetchMock.mock.lastCall?.[1];
    expect(init.method).toBe("POST");
    expect(init.headers).toBeUndefined();
    expect(init.body).toBe(form);
  });

  it("devuelve undefined en 204", async () => {
    vi.stubGlobal("fetch", respond(204));
    expect(await api("/auth/logout", { method: "POST" })).toBeUndefined();
  });

  it("convierte errores en ApiError con mensaje y código de la API", async () => {
    vi.stubGlobal("fetch", respond(403, { error: "Tu organización exige MFA", code: "MFA_SETUP_REQUIRED" }));
    const err = await failure(api("/assessments"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: "MFA_SETUP_REQUIRED", message: "Tu organización exige MFA" });
  });

  it("usa mensajes propios cuando la API no da uno útil", async () => {
    vi.stubGlobal("fetch", respond(429, { error: "Rate limit exceeded, retry in 1 minute" }));
    expect((await failure(api("/x"))).message).toBe("Demasiados intentos. Esperá un minuto y volvé a probar.");
    vi.stubGlobal("fetch", respond(400, { error: "Solicitud inválida" }));
    expect((await failure(api("/x"))).message).toBe("Solicitud inválida.");
    vi.stubGlobal("fetch", respond(502));
    expect((await failure(api("/x"))).message).toBe("Ocurrió un error en el servidor.");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect((await failure(api("/x"))).status).toBe(0);
  });
});

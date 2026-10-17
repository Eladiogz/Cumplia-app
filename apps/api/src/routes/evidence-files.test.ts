import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createOrganization, type Role } from "@cumplia/db";
import { createTestDb } from "@cumplia/db/testing";
import { buildApp } from "../app.js";
import { MemoryStorage } from "../storage/storage.js";
import type { TenantResolver } from "../tenant.js";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof buildApp>;
const storage = new MemoryStorage();
let orgA: string;
let orgB: string;

// Organización y rol vienen en headers (x-org, x-role): acá se prueba la evidencia, no el login.
const resolver: TenantResolver = (req) => {
  const org = req.headers["x-org"];
  if (typeof org !== "string") return null;
  return {
    organizationId: org,
    actorId: null,
    role: ((req.headers["x-role"] as string) ?? "ADMIN") as Role,
    mfaEnabled: false,
    mfaSetupRequired: false,
    emailVerified: true,
  };
};

beforeAll(async () => {
  ctx = await createTestDb();
  app = buildApp({ db: ctx.db, resolveTenant: resolver, storage });
  orgA = (await createOrganization(ctx.db, "A")).id;
  orgB = (await createOrganization(ctx.db, "B")).id;
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});
beforeEach(() => storage.objects.clear());

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

/** Arma un multipart/form-data como el que manda el navegador (campos antes que el archivo). */
function multipart(fields: Record<string, string>, file?: { name: string; type: string; data: Buffer }) {
  const boundary = `----cumplia${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = Object.entries(fields).map(([k, v]) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
  );
  if (file) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`),
      file.data,
      Buffer.from("\r\n"),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

const headers = (org: string, role: Role = "ADMIN") => ({ "x-org": org, "x-role": role });

/** Evaluación de A con el control A.8.5 respondido (la evidencia se cuelga de una respuesta). */
const setup = async () => {
  const id = (await app.inject({ method: "POST", url: "/assessments", headers: headers(orgA), payload: { frameworkId: "iso27001-2022" } })).json().id as string;
  await app.inject({
    method: "PUT",
    url: `/assessments/${id}/answers`,
    headers: headers(orgA),
    payload: { answers: [{ controlId: "A.8.5", applicable: true, maturity: 3 }] },
  });
  return id;
};

const upload = (id: string, file: { name: string; type: string; data: Buffer }, fields: Record<string, string> = { controlId: "A.8.5" }, org = orgA, role: Role = "ADMIN") => {
  const body = multipart(fields, file);
  return app.inject({ method: "POST", url: `/assessments/${id}/evidence/files`, payload: body.payload, headers: { ...body.headers, ...headers(org, role) } });
};

describe("evidencia con archivos", () => {
  it("guarda una captura con huella SHA-256 y la clave dentro de la carpeta de la organización", async () => {
    const id = await setup();
    const res = await upload(id, { name: "Captura MFA.png", type: "image/png", data: PNG }, { controlId: "A.8.5", description: "Consola de Entra con MFA" });
    expect(res.statusCode, res.body).toBe(201);
    const ev = res.json();
    expect(ev).toMatchObject({
      source: "archivo",
      description: "Consola de Entra con MFA",
      fileName: "Captura MFA.png",
      contentType: "image/png",
      fileSize: PNG.length,
      controlId: "A.8.5",
    });
    expect(ev.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(ev)).not.toContain("org/"); // la clave interna nunca sale
    expect([...storage.objects.keys()]).toEqual([`org/${orgA}/assessments/${id}/evidence/${ev.id}`]);
  });

  it("se lista y se descarga con cabeceras seguras", async () => {
    const id = await setup();
    const ev = (await upload(id, { name: "politica.pdf", type: "application/pdf", data: PDF })).json();
    const list = (await app.inject({ method: "GET", url: `/assessments/${id}/evidence`, headers: headers(orgA, "AUDITOR") })).json();
    expect(list).toEqual([expect.objectContaining({ id: ev.id, fileName: "politica.pdf", contentType: "application/pdf" })]);

    const file = await app.inject({ method: "GET", url: `/assessments/${id}/evidence/${ev.id}/file`, headers: headers(orgA, "AUDITOR") });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.equals(PDF)).toBe(true);
    expect(file.headers["content-type"]).toBe("application/pdf");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect(file.headers["content-security-policy"]).toContain("sandbox");
    expect(file.headers["content-disposition"]).toContain('filename="politica.pdf"');
    expect(file.headers["cache-control"]).toBe("private, no-store");
  });

  it("si no hay descripción usa el nombre, que se limpia de rutas y toma la extensión real", async () => {
    const id = await setup();
    const ev = (await upload(id, { name: "../../etc/passwd.exe", type: "application/octet-stream", data: PNG })).json();
    expect(ev.fileName).toBe("passwd.png");
    expect(ev.description).toBe("passwd.png");
  });

  it("rechaza archivos que no son imágenes o PDF, aunque digan serlo", async () => {
    const id = await setup();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await upload(id, { name: "captura.png", type: "image/png", data: svg });
    expect(res.statusCode).toBe(415);
    expect(storage.objects.size).toBe(0);
  });

  it("rechaza archivos de más de 10 MB", async () => {
    const id = await setup();
    const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);
    const res = await upload(id, { name: "enorme.png", type: "image/png", data: big });
    expect(res.statusCode).toBe(413);
    expect(storage.objects.size).toBe(0);
  });

  it("si el control no está respondido, no deja el archivo huérfano", async () => {
    const id = await setup();
    const res = await upload(id, { name: "x.png", type: "image/png", data: PNG }, { controlId: "A.5.1" });
    expect(res.statusCode).toBe(404);
    expect(storage.objects.size).toBe(0);
  });

  it("AUDITOR descarga pero no sube ni borra", async () => {
    const id = await setup();
    expect((await upload(id, { name: "x.png", type: "image/png", data: PNG }, undefined, orgA, "AUDITOR")).statusCode).toBe(403);
    const ev = (await upload(id, { name: "x.png", type: "image/png", data: PNG })).json();
    expect((await app.inject({ method: "DELETE", url: `/assessments/${id}/evidence/${ev.id}`, headers: headers(orgA, "AUDITOR") })).statusCode).toBe(403);
  });

  it("borrar una evidencia elimina el archivo y queda en la auditoría con su huella", async () => {
    const id = await setup();
    const ev = (await upload(id, { name: "x.png", type: "image/png", data: PNG })).json();
    expect((await app.inject({ method: "DELETE", url: `/assessments/${id}/evidence/${ev.id}`, headers: headers(orgA) })).statusCode).toBe(204);
    expect(storage.objects.size).toBe(0);
    expect((await app.inject({ method: "GET", url: `/assessments/${id}/evidence/${ev.id}/file`, headers: headers(orgA) })).statusCode).toBe(404);
    const log = (await app.inject({ method: "GET", url: "/audit-log", headers: headers(orgA) })).json() as { action: string; details: unknown }[];
    expect(log.find((l) => l.action === "evidence.delete")?.details).toMatchObject({ controlId: "A.8.5", fileName: "x.png", sha256: ev.sha256 });
  });

  it("otra organización no puede subir, descargar ni borrar", async () => {
    const id = await setup();
    const ev = (await upload(id, { name: "x.png", type: "image/png", data: PNG })).json();
    expect((await upload(id, { name: "y.png", type: "image/png", data: PNG }, undefined, orgB)).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/assessments/${id}/evidence/${ev.id}/file`, headers: headers(orgB) })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/assessments/${id}/evidence/${ev.id}`, headers: headers(orgB) })).statusCode).toBe(404);
    expect(storage.objects.size).toBe(1);
  });

  it("sin almacenamiento configurado responde 503", async () => {
    const id = await setup();
    const bare = buildApp({ db: ctx.db, resolveTenant: resolver });
    const body = multipart({ controlId: "A.8.5" }, { name: "x.png", type: "image/png", data: PNG });
    const res = await bare.inject({ method: "POST", url: `/assessments/${id}/evidence/files`, payload: body.payload, headers: { ...body.headers, ...headers(orgA) } });
    expect(res.statusCode).toBe(503);
    await bare.close();
  });
});

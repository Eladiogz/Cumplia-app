import { readFileSync } from "node:fs";
import { z } from "zod";

export const ControlSchema = z.object({
  id: z.string().regex(/^A\.\d+\.\d+$/),
  domain: z.string(),
  title: z.string().min(3),
});

export const FrameworkSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  domains: z.record(z.string()),
  controls: z.array(ControlSchema).min(1),
});

export type Control = z.infer<typeof ControlSchema>;
export type Framework = z.infer<typeof FrameworkSchema>;

const FILES: Record<string, string> = {
  "iso27001-2022": "iso27001-2022.json",
};

export function listFrameworks(): string[] {
  return Object.keys(FILES);
}

export function loadFramework(id: string): Framework {
  const file = FILES[id];
  if (!file) throw new Error(`Marco normativo desconocido: ${id}`);
  const url = new URL(`../data/${file}`, import.meta.url);
  const raw = JSON.parse(readFileSync(url, "utf-8"));
  const fw = FrameworkSchema.parse(raw);
  const ids = new Set(fw.controls.map((c) => c.id));
  if (ids.size !== fw.controls.length) throw new Error("IDs de control duplicados");
  return fw;
}

import { createRequire } from "node:module";

import { z } from "zod";

const nonblank = z
  .string()
  .regex(/\S/, "Must contain a non-whitespace character.");
export const configSchema = z.strictObject({
  $schema: z.string().optional(),
  tickets: nonblank,
  completion: z.strictObject({
    values: z
      .array(nonblank)
      .min(1, "At least one completion value is required."),
  }),
});

export function publicConfigSchema() {
  return z.toJSONSchema(configSchema, { target: "draft-7" });
}

export function configSchemaUrl() {
  const require = createRequire(import.meta.url);
  const manifest = require("../package.json") as { version: string };
  return `https://unpkg.com/@ykdz/tickets@${manifest.version}/ticket-graph.schema.json`;
}

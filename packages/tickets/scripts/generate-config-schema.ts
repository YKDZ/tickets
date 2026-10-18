import { writeFile } from "node:fs/promises";

import { publicConfigSchema } from "../src/config-schema.ts";

await writeFile(
  new URL("../ticket-graph.schema.json", import.meta.url),
  `${JSON.stringify(publicConfigSchema(), null, 2)}\n`,
);

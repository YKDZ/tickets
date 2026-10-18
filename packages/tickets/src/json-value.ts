import * as v from "valibot";

import type { JsonValue } from "./types.ts";

export const jsonValueSchema: v.GenericSchema<JsonValue> = v.lazy(() =>
  v.union([
    v.null(),
    v.boolean(),
    v.pipe(v.number(), v.finite()),
    v.string(),
    v.array(jsonValueSchema),
    v.record(v.string(), jsonValueSchema),
  ]),
);

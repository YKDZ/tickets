import { createRequire } from "node:module";

import { toJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";

const nonblank = v.pipe(v.string(), v.regex(/\S/, "必须包含非空白字符。"));
const completionEntries = {
  values: v.pipe(v.array(nonblank), v.minLength(1, "至少需要一个完成值。")),
};
// 使用无原型字段表，使 constructor 等未知字段也按普通配置字段拒绝。
Object.setPrototypeOf(completionEntries, null);
const configEntries = {
  $schema: v.optional(v.string()),
  tickets: nonblank,
  completion: v.strictObject(completionEntries),
};
Object.setPrototypeOf(configEntries, null);
export const configSchema = v.strictObject(configEntries);

export function publicConfigSchema() {
  return toJsonSchema(configSchema);
}

export function configSchemaUrl() {
  const require = createRequire(import.meta.url);
  const manifest = require("../package.json") as { version: string };
  return `https://unpkg.com/@ykdz/tickets@${manifest.version}/ticket-graph.schema.json`;
}

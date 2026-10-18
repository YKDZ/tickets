import {
  toStandardJsonSchema,
  type ConversionConfig,
} from "@valibot/to-json-schema";
import * as v from "valibot";

/** 上游执行器要求失败结果不带 value；保留 Valibot 的验证及官方 JSON Schema 投影。 */
export function standardSchema<
  T extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
>(
  schema: T,
  ignoreActions: string[] = ["finite"],
  libraryOptions: ConversionConfig = {},
) {
  const converted = toStandardJsonSchema(
    v.message(schema, "输入值不符合要求。"),
  );
  const projectionOptions: ConversionConfig = {
    ignoreActions,
    overrideSchema: ({ valibotSchema }) =>
      valibotSchema.type === "literal" &&
      "literal" in valibotSchema &&
      typeof valibotSchema.literal === "boolean"
        ? { type: "boolean", const: valibotSchema.literal }
        : undefined,
    ...libraryOptions,
  };
  const adapted: typeof converted = {
    "~standard": {
      ...converted["~standard"],
      jsonSchema: {
        input: (options) =>
          converted["~standard"].jsonSchema.input({
            ...options,
            libraryOptions: { ...options.libraryOptions, ...projectionOptions },
          }),
        output: (options) =>
          converted["~standard"].jsonSchema.output({
            ...options,
            libraryOptions: { ...options.libraryOptions, ...projectionOptions },
          }),
      },
      validate(value) {
        const result = converted["~standard"].validate(value);
        // 所有声明均只校验；保留原值，避免对象模式过滤历史附加字段。
        if (result instanceof Promise)
          return result.then((resolved) =>
            resolved.issues === undefined
              ? { value: value as v.InferOutput<T> }
              : { issues: resolved.issues },
          );
        return result.issues === undefined
          ? { value: value as v.InferOutput<T> }
          : { issues: result.issues };
      },
    },
  };
  return adapted;
}

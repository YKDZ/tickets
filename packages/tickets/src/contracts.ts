import {
  defineCli,
  helpCapability,
  outputCapability,
  versionCapability,
  text,
} from "@ykdz/cli-contract";
import * as v from "valibot";

import type { CliCommandIdentity } from "./cli-command-identity.ts";
import {
  Failure,
  configuration,
  initialize,
  history,
  check,
  list,
  update,
  withLock,
} from "./engine.ts";
import { jsonValueSchema } from "./json-value.ts";
import { standardSchema } from "./standard-schema.ts";
import type { Effects } from "./types.ts";

const string = v.string();
const id = v.pipe(v.string(), v.regex(/^[0-9]+$/));
const nonblank = v.pipe(v.string(), v.regex(/\S/));
const configField = {
  kind: "valueOption",
  longOption: "--config",
  description: "票集配置文件",
} as const;
const scope = v.strictObject({ config: string, tickets: string });
const issue = v.strictObject({
  code: string,
  message: string,
  ticket: string,
  file: string,
  key: string,
  field: v.optional(string),
  target: v.optional(string),
  reason: v.optional(string),
  offset: v.optional(v.number()),
  path: v.optional(v.array(string)),
});
const changeFields = {
  ticket: id,
  field: v.picklist(["status", "blocked_by"]),
  before: v.optional(jsonValueSchema),
  after: v.union([string, v.array(id)]),
  changed: v.boolean(),
  state: v.picklist(["unchanged", "saved", "failed", "notExecuted"]),
  ticketSaved: v.boolean(),
  historySaved: v.union([v.boolean(), v.null()]),
};
export const changeSchema = v.strictObject(changeFields);
const effectSchema = v.strictObject({
  configCreated: v.boolean(),
  configSaved: v.union([v.boolean(), v.null()]),
  ticketSaved: v.optional(v.boolean()),
  historySaved: v.optional(v.union([v.boolean(), v.null()])),
  ticket: v.optional(id),
  field: v.optional(v.picklist(["status", "blocked_by"])),
  before: v.optional(jsonValueSchema),
  after: v.optional(jsonValueSchema),
  results: v.optional(v.array(changeSchema)),
});
export const failureSchema = v.strictObject({
  error: v.strictObject({
    code: string,
    message: string,
    file: v.optional(string),
    cause: v.optional(string),
    ticket: v.optional(id),
    target: v.optional(id),
    field: v.optional(string),
    files: v.optional(v.array(string)),
    line: v.optional(v.number()),
    scope: v.optional(scope),
    issues: v.optional(
      v.array(
        v.union([
          issue,
          v.strictObject({ path: string, keyword: string, message: string }),
        ]),
      ),
    ),
  }),
  effects: effectSchema,
});

export const inputs = {
  init: v.strictObject({
    config: string,
    tickets: string,
    completionValues: v.pipe(v.array(string), v.minLength(1)),
  }),
  check: v.strictObject({ config: string }),
  list: v.strictObject({
    config: string,
    filter: v.optional(v.picklist(["all", "unblocked", "blocked"])),
  }),
  setStatus: v.strictObject({
    config: string,
    tickets: v.pipe(v.array(id), v.minLength(1)),
    status: nonblank,
  }),
  setDeps: v.pipe(
    v.strictObject({
      config: string,
      ticket: id,
      dependencies: v.optional(v.pipe(v.array(id), v.minLength(1))),
      clear: v.optional(v.literal(true)),
    }),
    v.check(
      (value) =>
        Object.hasOwn(value, "dependencies") !== Object.hasOwn(value, "clear"),
      "必须且只能提供 dependencies、clear 中的一项。",
    ),
  ),
  history: v.strictObject({ config: string, ticket: v.optional(id) }),
};

const commonUpdate = {
  scope,
  history: string,
  valid: v.boolean(),
  issues: v.array(issue),
};
export const outputs = {
  init: v.strictObject({ scope, created: v.boolean() }),
  check: v.strictObject({ scope, valid: v.boolean(), total: v.number() }),
  list: v.strictObject({
    scope,
    filter: v.picklist(["all", "unblocked", "blocked"]),
    total: v.number(),
    tickets: v.array(
      v.strictObject({
        id,
        file: string,
        status: string,
        delivery_complete: v.boolean(),
        blocked_by: v.array(id),
        blocked_by_unfinished: v.array(id),
      }),
    ),
  }),
  setStatus: v.strictObject({
    ...commonUpdate,
    results: v.array(changeSchema),
  }),
  setDeps: v.strictObject({ ...commonUpdate, ...changeFields }),
  history: v.strictObject({
    scope: v.strictObject({
      config: string,
      history: string,
      ticket: v.union([id, v.null()]),
    }),
    events: v.array(
      v.objectWithRest(
        {
          ticket: id,
          field: string,
          time: string,
          before: jsonValueSchema,
          after: jsonValueSchema,
        },
        v.unknown(),
      ),
    ),
  }),
};

interface Dependencies {
  effects: Effects;
  getManifest(): Record<string, unknown>;
}
const define = defineCli<Dependencies>();
const failures = {
  rejected: {
    description: "执行失败及实际写入效果",
    schema: standardSchema(failureSchema),
    exitCode: 1,
  },
} as const;

async function attempt<T>(
  effects: Effects,
  action: () => T | Promise<T>,
): Promise<
  | { ok: true; data: T }
  | { ok: false; data: v.InferOutput<typeof failureSchema> }
> {
  try {
    return { ok: true, data: await action() };
  } catch (error) {
    if (!(error instanceof Failure)) throw error;
    // 省略内部错误中不存在的可选信息，保留旧值的 JSON 类型。
    const data: unknown = JSON.parse(
      JSON.stringify({ error: error.details, effects }),
    );
    if (!v.is(failureSchema, data))
      throw new Error("执行错误不符合票图失败契约。", { cause: error });
    return { ok: false, data };
  }
}

const init = define.command("init")({
  kind: "command",
  parent: "ticketGraph",
  name: "init",
  description: "创建配置，不覆盖已有文件；创建后用 check 检查票图。",
  fields: {
    config: configField,
    tickets: {
      kind: "valueOption",
      longOption: "--tickets",
      description: "票目录，相对配置文件解析",
    },
    completionValues: {
      kind: "repeatableOption",
      longOption: "--completion-value",
      description: "项目完成值，可重复提供",
    },
  },
  input: standardSchema(inputs.init),
  success: {
    kind: "data",
    variants: {
      created: {
        description: "已创建配置",
        schema: standardSchema(outputs.init),
        exitCode: 0,
      },
    },
  },
  failures,
  async handler({ input, dependencies, outcome }) {
    const result = await attempt(dependencies.effects, () =>
      initialize(
        {
          config: input.config,
          tickets: input.tickets,
          "completion-value": input.completionValues,
        },
        dependencies.effects,
      ),
    );
    return result.ok
      ? outcome.data.created(result.data)
      : outcome.failure.rejected(result.data);
  },
});
const checkCommand = define.command("check")({
  kind: "command",
  parent: "ticketGraph",
  name: "check",
  description: "检查字段、引用、自依赖和环。",
  fields: { config: configField },
  input: standardSchema(inputs.check),
  success: {
    kind: "data",
    variants: {
      checked: {
        description: "票图检查结果",
        schema: standardSchema(outputs.check),
        exitCode: 0,
      },
    },
  },
  failures,
  async handler({ input, dependencies, outcome }) {
    const result = await attempt(dependencies.effects, () =>
      check(configuration(input.config)),
    );
    return result.ok
      ? outcome.data.checked(result.data)
      : outcome.failure.rejected(result.data);
  },
});
const listCommand = define.command("list")({
  kind: "command",
  parent: "ticketGraph",
  name: "list",
  description: "查询票，前置是否满足不代表实施顺序。",
  fields: {
    config: configField,
    filter: {
      kind: "valueOption",
      longOption: "--filter",
      description: "筛选方式，默认 all",
    },
  },
  input: standardSchema(inputs.list),
  success: {
    kind: "data",
    variants: {
      listed: {
        description: "票集查询结果",
        schema: standardSchema(outputs.list),
        exitCode: 0,
      },
    },
  },
  failures,
  async handler({ input, dependencies, outcome }) {
    const result = await attempt(dependencies.effects, () =>
      list(configuration(input.config), input.filter ?? "all"),
    );
    return result.ok
      ? outcome.data.listed(result.data)
      : outcome.failure.rejected(result.data);
  },
});
const setStatus = define.command("setStatus")({
  kind: "command",
  parent: "ticketGraph",
  name: "set-status",
  description: "将一张或多张票设为同一状态，先整批预检，再逐票保存。",
  fields: {
    config: configField,
    tickets: { kind: "variadicPositional", description: "票标识，保留前导零" },
    status: {
      kind: "valueOption",
      longOption: "--status",
      description: "整批目标状态，保留原值",
    },
  },
  input: standardSchema(inputs.setStatus),
  success: {
    kind: "data",
    variants: {
      updated: {
        description: "逐票状态修改结果",
        schema: standardSchema(outputs.setStatus),
        exitCode: 0,
      },
    },
  },
  failures,
  async handler({ input, dependencies, outcome }) {
    const result = await attempt(dependencies.effects, () => {
      const config = configuration(input.config);
      return withLock(config, () =>
        update(
          config,
          {
            field: "status",
            tickets: input.tickets,
            after: input.status,
          },
          dependencies.effects,
        ),
      );
    });
    return result.ok
      ? outcome.data.updated(result.data)
      : outcome.failure.rejected(result.data);
  },
});
const setDeps = define.command("setDeps")({
  kind: "command",
  parent: "ticketGraph",
  name: "set-deps",
  description: "替换依赖；前置票和 --clear 必须且只能提供一项。",
  fields: {
    config: configField,
    ticket: { kind: "positional", description: "目标票标识" },
    dependencies: { kind: "variadicPositional", description: "前置票标识" },
    clear: { kind: "flag", longOption: "--clear", description: "显式清空依赖" },
  },
  input: standardSchema(inputs.setDeps, [], {
    overrideAction: ({ valibotAction, jsonSchema }) =>
      valibotAction.type === "check"
        ? {
            ...jsonSchema,
            oneOf: [
              { required: ["dependencies"], not: { required: ["clear"] } },
              { required: ["clear"], not: { required: ["dependencies"] } },
            ],
          }
        : undefined,
  }),
  success: {
    kind: "data",
    variants: {
      updated: {
        description: "依赖修改结果",
        schema: standardSchema(outputs.setDeps),
        exitCode: 0,
      },
    },
  },
  failures,
  async handler({ input, dependencies, outcome }) {
    const result = await attempt(dependencies.effects, async () => {
      const config = configuration(input.config);
      const { results, ...common } = await withLock(config, () =>
        update(
          config,
          {
            field: "blocked_by",
            ticket: input.ticket,
            after: input.dependencies ?? [],
          },
          dependencies.effects,
        ),
      );
      return { ...common, ...results[0]! };
    });
    return result.ok
      ? outcome.data.updated(result.data)
      : outcome.failure.rejected(result.data);
  },
});
const historyCommand = define.command("history")({
  kind: "command",
  parent: "ticketGraph",
  name: "history",
  description: "查询变更历史；历史不参与当前票图计算。",
  fields: {
    config: configField,
    ticket: {
      kind: "valueOption",
      longOption: "--ticket",
      description: "仅查询指定票",
    },
  },
  input: standardSchema(inputs.history),
  success: {
    kind: "data",
    variants: {
      listed: {
        description: "历史查询结果",
        schema: standardSchema(outputs.history),
        exitCode: 0,
      },
    },
  },
  failures,
  async handler({ input, dependencies, outcome }) {
    const result = await attempt(dependencies.effects, () =>
      history(configuration(input.config), input.ticket),
    );
    return result.ok
      ? outcome.data.listed(result.data)
      : outcome.failure.rejected(result.data);
  },
});

export function createCliContract(identity: CliCommandIdentity) {
  return define({
    root: "ticketGraph",
    usageFailureExitCode: 2,
    version: versionCapability({
      value: text.line(`${identity.commandName} ${identity.version}`),
      shortAlias: "-V",
    }),
    help: helpCapability({
      shortAlias: "-h",
      headings: {
        usage: "用法",
        commands: "命令",
        arguments: "参数",
        options: "选项",
      },
      wording: {
        commandPlaceholder: "命令",
        choices: "可选值：{choices}",
        default: "默认值：{value}",
      },
    }),
    output: outputCapability({ defaultFormat: "structured" }),
    commands: {
      ticketGraph: {
        kind: "rootGroup",
        name: identity.commandName,
        description: "票图管理工具；各子命令通过 --config 选择票集。",
      },
      ...init,
      ...checkCommand,
      ...listCommand,
      ...setStatus,
      ...setDeps,
      ...historyCommand,
      ...define.command("schema")({
        kind: "command",
        parent: "ticketGraph",
        name: "schema",
        description: "导出完整 CLI 契约及输入和输出结构定义。",
        fields: {},
        input: standardSchema(v.strictObject({})),
        success: {
          kind: "data",
          variants: {
            exported: {
              description: "完整 CLI 契约",
              exitCode: 0,
              schema: standardSchema(
                v.strictObject({ manifest: v.record(v.string(), v.unknown()) }),
              ),
            },
          },
        },
        failures: {},
        handler: ({ dependencies, outcome }) =>
          outcome.data.exported({ manifest: dependencies.getManifest() }),
      }),
    },
  });
}

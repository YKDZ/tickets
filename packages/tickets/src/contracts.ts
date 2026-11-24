import {
  defineCli,
  helpCapability,
  schemaCapability,
  versionCapability,
  text,
} from "@ykdz/cli-contract";
import { z } from "zod";

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
import type { Effects } from "./types.ts";

const string = z.string();
const id = z.string().regex(/^[0-9]+$/);
const nonblank = z.string().regex(/\S/);
const configField = {
  kind: "valueOption",
  longOption: "--config",
  description: "Ticket set configuration file",
} as const;
const scope = z.strictObject({ config: string, tickets: string });
const issue = z.strictObject({
  code: string,
  message: string,
  ticket: string,
  file: string,
  key: string,
  field: string.optional(),
  target: string.optional(),
  reason: string.optional(),
  offset: z.number().optional(),
  path: z.array(string).optional(),
});
const changeFields = {
  ticket: id,
  field: z.enum(["status", "blocked_by"]),
  before: jsonValueSchema.optional(),
  after: z.union([string, z.array(id)]),
  changed: z.boolean(),
  state: z.enum(["unchanged", "saved", "failed", "notExecuted"]),
  ticketSaved: z.boolean(),
  historySaved: z.union([z.boolean(), z.null()]),
};
export const changeSchema = z.strictObject(changeFields);
const effectSchema = z.strictObject({
  configCreated: z.boolean(),
  configSaved: z.union([z.boolean(), z.null()]),
  ticketSaved: z.boolean().optional(),
  historySaved: z.union([z.boolean(), z.null()]).optional(),
  ticket: id.optional(),
  field: z.enum(["status", "blocked_by"]).optional(),
  before: jsonValueSchema.optional(),
  after: jsonValueSchema.optional(),
  results: z.array(changeSchema).optional(),
});
export const failureSchema = z.strictObject({
  error: z.strictObject({
    code: string,
    message: string,
    file: string.optional(),
    cause: string.optional(),
    ticket: id.optional(),
    target: id.optional(),
    field: string.optional(),
    files: z.array(string).optional(),
    line: z.number().optional(),
    scope: scope.optional(),
    issues: z
      .array(
        z.union([
          issue,
          z.strictObject({ path: string, keyword: string, message: string }),
        ]),
      )
      .optional(),
  }),
  effects: effectSchema,
});

export const inputs = {
  init: z.strictObject({
    config: string,
    tickets: string,
    completionValues: z.array(string).min(1),
  }),
  check: z.strictObject({ config: string }),
  list: z.strictObject({
    config: string,
    filter: z.enum(["all", "unblocked", "blocked"]).optional(),
  }),
  setStatus: z.strictObject({
    config: string,
    tickets: z.array(id).min(1),
    status: nonblank,
  }),
  setDeps: z.strictObject({
    config: string,
    ticket: id,
    dependencies: z.array(id).min(1).optional(),
    clear: z.literal(true).optional(),
  }),
  history: z.strictObject({ config: string, ticket: id.optional() }),
};

const commonUpdate = {
  scope,
  history: string,
  valid: z.boolean(),
  issues: z.array(issue),
};
export const outputs = {
  init: z.strictObject({ scope, created: z.boolean() }),
  check: z.strictObject({ scope, valid: z.boolean(), total: z.number() }),
  list: z.strictObject({
    scope,
    filter: z.enum(["all", "unblocked", "blocked"]),
    total: z.number(),
    tickets: z.array(
      z.strictObject({
        id,
        file: string,
        status: string,
        delivery_complete: z.boolean(),
        blocked_by: z.array(id),
        blocked_by_unfinished: z.array(id),
      }),
    ),
  }),
  setStatus: z.strictObject({
    ...commonUpdate,
    results: z.array(changeSchema),
  }),
  setDeps: z.strictObject({ ...commonUpdate, ...changeFields }),
  history: z.strictObject({
    scope: z.strictObject({
      config: string,
      history: string,
      ticket: z.union([id, z.null()]),
    }),
    events: z.array(
      z.looseObject({
        ticket: id,
        field: string,
        time: string,
        before: jsonValueSchema,
        after: jsonValueSchema,
      }),
    ),
  }),
};

function preserveJsonOutput<Schema extends z.ZodType>(
  schema: Schema,
): { "~standard": Schema["~standard"] } {
  return {
    "~standard": {
      ...schema["~standard"],
      validate(value: unknown) {
        const result = schema.safeParse(value);
        // Zod drops own __proto__ keys when rebuilding objects. Keep the validated JSON intact.
        return result.success
          ? { value: value as z.output<Schema> }
          : { issues: result.error.issues };
      },
    },
  };
}

interface Dependencies {
  effects: Effects;
}
const define = defineCli<Dependencies>();
const failures = {
  rejected: {
    description: "Execution failure and saved changes",
    schema: preserveJsonOutput(failureSchema),
    exitCode: 1,
  },
} as const;

async function attempt<T>(
  effects: Effects,
  action: () => T | Promise<T>,
): Promise<
  { ok: true; data: T } | { ok: false; data: z.output<typeof failureSchema> }
> {
  try {
    return { ok: true, data: await action() };
  } catch (error) {
    if (!(error instanceof Failure)) throw error;
    // Omit absent error details while preserving the JSON types of previous values.
    const data: unknown = JSON.parse(
      JSON.stringify({ error: error.details, effects }),
    );
    const parsed = failureSchema.safeParse(data);
    if (!parsed.success)
      throw new Error(
        "The error does not match the ticket graph failure contract.",
        { cause: error },
      );
    return { ok: false, data: data as z.output<typeof failureSchema> };
  }
}

function describeChange(change: z.output<typeof changeSchema>): string {
  if (change.state === "unchanged")
    return `Ticket ${change.ticket}: unchanged.`;
  if (change.state === "notExecuted")
    return `Ticket ${change.ticket}: not attempted.`;
  return describeTicketSave(
    change.ticket,
    change.ticketSaved,
    change.historySaved,
  );
}

function describeTicketSave(
  ticket: string,
  ticketSaved?: boolean,
  historySaved?: boolean | null,
): string {
  const history =
    historySaved === null
      ? "could not confirm the write"
      : historySaved
        ? "saved"
        : "not saved";
  return `Ticket ${ticket}: ${ticketSaved ? "saved" : "not saved"}. History: ${history}.`;
}

export function describeEffects(
  effects: z.output<typeof effectSchema>,
): string[] {
  if (effects.results !== undefined) return effects.results.map(describeChange);
  if (effects.configCreated) {
    return [
      effects.configSaved
        ? "Configuration saved."
        : "Configuration created. Its contents could not be confirmed.",
    ];
  }
  if (effects.ticket === undefined) return [];
  return [
    describeTicketSave(
      effects.ticket,
      effects.ticketSaved,
      effects.historySaved,
    ),
  ];
}

function describeFailure({ error, effects }: z.output<typeof failureSchema>) {
  return text.lines([
    error.message,
    ...(error.issues ?? []).map(({ message }) => message),
    ...describeEffects(effects),
  ]);
}

const init = define.command("init")({
  kind: "command",
  parent: "ticketGraph",
  name: "init",
  description:
    "Create a configuration file. Run check to validate the ticket graph.",
  fields: {
    config: configField,
    tickets: {
      kind: "valueOption",
      longOption: "--tickets",
      description: "Ticket directory relative to the configuration file",
    },
    completionValues: {
      kind: "repeatableOption",
      longOption: "--completion-value",
      description: "Completion value. Repeat for multiple values.",
    },
  },
  input: inputs.init,
  examples: [
    {
      input: {
        config: "ticket-graph.json",
        tickets: "issues",
        completionValues: ["done"],
      },
    },
  ],
  outputs: ({ atomic }) => {
    const execution = atomic({
      success: {
        kind: "data",
        variants: {
          created: {
            description: "Configuration created",
            schema: outputs.init,
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
    return {
      default: "structured",
      modes: {
        structured: execution.structured({
          description: "Machine-readable result.",
        }),
        text: execution.text({
          description: "English result.",
          success: {
            created: ({ scope }) =>
              text.line(`Created configuration at ${scope.config}.`),
          },
          failures: { rejected: describeFailure },
        }),
      },
    };
  },
});
const checkCommand = define.command("check")({
  kind: "command",
  parent: "ticketGraph",
  name: "check",
  description:
    "Check ticket fields and dependencies for invalid references and cycles.",
  fields: { config: configField },
  input: inputs.check,
  examples: [{ input: { config: "ticket-graph.json" } }],
  outputs: ({ atomic }) => {
    const execution = atomic({
      success: {
        kind: "data",
        variants: {
          checked: {
            description: "Ticket graph check result",
            schema: outputs.check,
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
    return {
      default: "structured",
      modes: {
        structured: execution.structured({
          description: "Machine-readable result.",
        }),
        text: execution.text({
          description: "English result.",
          success: {
            checked: ({ total }) =>
              text.line(`Checked ${total} tickets. The ticket graph is valid.`),
          },
          failures: { rejected: describeFailure },
        }),
      },
    };
  },
});
const listCommand = define.command("list")({
  kind: "command",
  parent: "ticketGraph",
  name: "list",
  description: "List tickets and their outstanding prerequisites.",
  fields: {
    config: configField,
    filter: {
      kind: "valueOption",
      longOption: "--filter",
      description: "Ticket filter. Defaults to all.",
    },
  },
  input: inputs.list,
  examples: [{ input: { config: "ticket-graph.json", filter: "blocked" } }],
  outputs: ({ atomic }) => {
    const execution = atomic({
      success: {
        kind: "data",
        variants: {
          listed: {
            description: "Ticket list",
            schema: outputs.list,
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
    return {
      default: "structured",
      modes: {
        structured: execution.structured({
          description: "Machine-readable result.",
        }),
        text: execution.text({
          description: "English result.",
          success: {
            listed: ({ tickets, total }) =>
              text.lines([
                `${total} tickets`,
                ...tickets.map(
                  (ticket) =>
                    `${ticket.id}: ${ticket.status} (outstanding prerequisites: ${ticket.blocked_by_unfinished.join(", ") || "none"})`,
                ),
              ]),
          },
          failures: { rejected: describeFailure },
        }),
      },
    };
  },
});
const setStatus = define.command("setStatus")({
  kind: "command",
  parent: "ticketGraph",
  name: "set-status",
  description:
    "Set the status of one or more tickets after validating the batch.",
  fields: {
    config: configField,
    tickets: {
      kind: "variadicPositional",
      description: "Ticket IDs, including leading zeros",
    },
    status: {
      kind: "valueOption",
      longOption: "--status",
      description: "Status value to apply to each ticket",
    },
  },
  input: inputs.setStatus,
  examples: [
    { input: { config: "ticket-graph.json", tickets: ["01"], status: "done" } },
  ],
  outputs: ({ atomic }) => {
    const execution = atomic({
      success: {
        kind: "data",
        variants: {
          updated: {
            description: "Per-ticket status changes",
            schema: preserveJsonOutput(outputs.setStatus),
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
    return {
      default: "structured",
      modes: {
        structured: execution.structured({
          description: "Machine-readable result.",
        }),
        text: execution.text({
          description: "English result.",
          success: {
            updated: ({ results, issues }) =>
              text.lines([
                `${results.length} tickets processed.`,
                ...results.map(describeChange),
                ...issues.map(({ message }) => message),
              ]),
          },
          failures: { rejected: describeFailure },
        }),
      },
    };
  },
});
const setDeps = define.command("setDeps")({
  kind: "command",
  parent: "ticketGraph",
  name: "set-deps",
  description: "Replace a ticket’s prerequisites or clear them with --clear.",
  fields: {
    config: configField,
    ticket: { kind: "positional", description: "Target ticket ID" },
    dependencies: {
      kind: "variadicPositional",
      description: "Prerequisite ticket IDs",
    },
    clear: {
      kind: "flag",
      longOption: "--clear",
      description: "Clear all prerequisites",
    },
  },
  input: inputs.setDeps,
  examples: [
    {
      input: {
        config: "ticket-graph.json",
        ticket: "02",
        dependencies: ["01"],
      },
    },
  ],
  usageConstraints: [
    { kind: "count", fields: ["dependencies", "clear"], min: 1, max: 1 },
  ],
  outputs: ({ atomic }) => {
    const execution = atomic({
      success: {
        kind: "data",
        variants: {
          updated: {
            description: "Dependency change result",
            schema: preserveJsonOutput(outputs.setDeps),
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
    return {
      default: "structured",
      modes: {
        structured: execution.structured({
          description: "Machine-readable result.",
        }),
        text: execution.text({
          description: "English result.",
          success: {
            updated: (result) =>
              text.lines([
                describeChange(result),
                ...result.issues.map(({ message }) => message),
              ]),
          },
          failures: { rejected: describeFailure },
        }),
      },
    };
  },
});
const historyCommand = define.command("history")({
  kind: "command",
  parent: "ticketGraph",
  name: "history",
  description: "Read the ticket change history.",
  fields: {
    config: configField,
    ticket: {
      kind: "valueOption",
      longOption: "--ticket",
      description: "Filter history by ticket ID",
    },
  },
  input: inputs.history,
  examples: [{ input: { config: "ticket-graph.json", ticket: "01" } }],
  outputs: ({ atomic }) => {
    const execution = atomic({
      success: {
        kind: "data",
        variants: {
          listed: {
            description: "Ticket change history",
            schema: preserveJsonOutput(outputs.history),
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
    return {
      default: "structured",
      modes: {
        structured: execution.structured({
          description: "Machine-readable result.",
        }),
        text: execution.text({
          description: "English result.",
          success: {
            listed: ({ events }) =>
              text.lines([
                `${events.length} changes`,
                ...events.map(
                  ({ ticket, field, time, before, after }) =>
                    `${time} ${ticket} ${field}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`,
                ),
              ]),
          },
          failures: { rejected: describeFailure },
        }),
      },
    };
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
        usage: "Usage",
        commands: "Commands",
        arguments: "Arguments",
        options: "Options",
        schema: "Contract Discovery",
        examples: "Examples",
      },
      wording: {
        commandPlaceholder: "command",
        choices: "(choices: {choices})",
        default: "(default: {value})",
        countExactly: "Choose exactly {count} of {fields}.",
      },
    }),
    schema: schemaCapability({
      description: text.line("Inspect command contracts and wire schemas."),
    }),
    commands: {
      ticketGraph: {
        kind: "rootGroup",
        name: identity.commandName,
        description:
          "Manage Markdown ticket graphs. Select a ticket set with --config.",
      },
      ...init,
      ...checkCommand,
      ...listCommand,
      ...setStatus,
      ...setDeps,
      ...historyCommand,
    },
  });
}

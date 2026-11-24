import {
  CliWriteError,
  executeCli,
  parseCliInvocation,
  type WriteCliOutput,
} from "@ykdz/cli-contract";

import type { CliCommandIdentity } from "./cli-command-identity.ts";
import { createCliContract, describeEffects } from "./contracts.ts";
import type { Effects } from "./types.ts";

export type CliRuntime = {
  readonly argv: readonly string[];
  readonly write: WriteCliOutput;
  readonly identity: CliCommandIdentity;
};

export async function runCli(runtime: CliRuntime): Promise<number> {
  const effects: Effects = {
    configCreated: false,
    configSaved: false,
    ticketSaved: false,
    historySaved: false,
  };
  let textOutput = false;
  try {
    const contract = createCliContract(runtime.identity);
    const invocation = parseCliInvocation(contract, runtime.argv.slice(2));
    textOutput =
      invocation.kind === "parsed" && invocation.outputMode === "text";
    const result = await (invocation.kind === "parsed"
      ? executeCli(contract, {
          invocation,
          dependencies: { effects },
          write: runtime.write,
        })
      : executeCli(contract, { invocation, write: runtime.write }));
    return result.exitCode;
  } catch (error) {
    const diagnostic = {
      error: {
        code:
          error instanceof CliWriteError ? "OUTPUT_FAILED" : "INTERNAL_ERROR",
        message:
          error instanceof CliWriteError
            ? "Output was interrupted. Changes already saved still apply."
            : "Command execution failed.",
        ...(error instanceof Error ? { cause: error.message } : {}),
      },
      effects,
    };
    try {
      await runtime.write({
        destination: "stderr",
        chunk: textOutput
          ? `${[diagnostic.error.message, ...describeEffects(effects)].join("\n")}\n`
          : `${JSON.stringify(diagnostic)}\n`,
      });
    } catch {
      // Preserve the failure exit code if diagnostics cannot be written.
    }
    return 1;
  }
}

import {
  CliWriteError,
  executeCli,
  parseCliInvocation,
  type WriteCliOutput,
} from "@ykdz/cli-contract";

import type { CliCommandIdentity } from "./cli-command-identity.ts";
import { createCliContract } from "./contracts.ts";
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
  try {
    const contract = createCliContract(runtime.identity);
    const result = await executeCli(contract, {
      invocation: parseCliInvocation(contract, runtime.argv.slice(2)),
      dependencies: { effects, getManifest: () => ({ ...contract.manifest }) },
      write: runtime.write,
    });
    return result.exitCode;
  } catch (error) {
    const diagnostic = {
      error: {
        code:
          error instanceof CliWriteError ? "OUTPUT_FAILED" : "INTERNAL_ERROR",
        message:
          error instanceof CliWriteError
            ? "结果未完整输出；已发生的修改仍然有效。"
            : "命令执行异常。",
        ...(error instanceof Error ? { cause: error.message } : {}),
      },
      effects,
    };
    try {
      await runtime.write({
        destination: "stderr",
        chunk: `${JSON.stringify(diagnostic)}\n`,
      });
    } catch {
      // 诊断通道故障不能改变失败退出码。
    }
    return 1;
  }
}

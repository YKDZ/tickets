import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Ajv } from "ajv";

import { cliCommandIdentity } from "../../../src/cli-command-identity.ts";
import type { CliJourney } from "../journey.ts";

const journey: CliJourney = {
  name: "ticket-graph",
  modes: ["source", "distribution", "packed"],
  async setup({ workDir }) {
    await mkdir(path.join(workDir, "issues"));
    await writeFile(
      path.join(workDir, "issues/01-first.md"),
      "---\nstatus: open\nblocked_by: []\n---\n正文。\n",
    );
    await writeFile(
      path.join(workDir, "issues/02-second.md"),
      '---\nstatus: open\nblocked_by: ["01"]\n---\n后继。\n',
    );
  },
  commands() {
    const config = ["--config", "ticket-graph.json"];
    return [
      {
        name: "初始化",
        args: [
          "init",
          ...config,
          "--tickets",
          "issues",
          "--completion-value",
          " done ",
        ],
      },
      { name: "检查", args: ["check", ...config] },
      { name: "前置未完成", args: ["list", ...config, "--filter", "blocked"] },
      {
        name: "批量修改",
        args: ["set-status", ...config, "01", "02", "--status", " done "],
      },
      {
        name: "无变化",
        args: ["set-status", ...config, "01", "--status", " done "],
      },
      { name: "引入环失败", args: ["set-deps", ...config, "01", "02"] },
      { name: "清空依赖", args: ["set-deps", ...config, "02", "--clear"] },
      { name: "完成查询", args: ["list", ...config] },
      { name: "历史", args: ["history", ...config] },
      {
        name: "禁止覆盖",
        args: [
          "init",
          ...config,
          "--tickets",
          "issues",
          "--completion-value",
          "done",
        ],
      },
      { name: "用法错误", args: ["set-deps", ...config, "02"] },
      { name: "完整契约", args: ["schema"] },
      { name: "帮助", args: ["--help"] },
      { name: "版本", args: ["--version"] },
    ];
  },
  async assertions({ context, results }) {
    const identity = cliCommandIdentity(
      JSON.parse(
        await readFile(path.join(context.packageRoot, "package.json"), "utf8"),
      ),
    );
    const data = (index: number) => JSON.parse(results[index]!.stdout).data;
    for (const [index, result] of results.entries()) {
      const expected = index === 5 || index === 9 ? 1 : index === 10 ? 2 : 0;
      assert.equal(
        result.exitCode,
        expected,
        `${result.commandName}: ${result.stderr}`,
      );
      if (expected === 0) assert.equal(result.stderr, "");
      else assert.equal(result.stdout, "");
    }
    assert.equal(data(0).created, true);
    assert.equal(data(1).total, 2);
    assert.deepEqual(
      data(2).tickets.map((ticket: { id: string }) => ticket.id),
      ["02"],
    );
    assert.deepEqual(
      data(3).results.map((result: { state: string }) => result.state),
      ["saved", "saved"],
    );
    assert.equal(data(4).results[0].state, "unchanged");
    assert.equal(
      JSON.parse(results[5]!.stderr).data.error.code,
      "INVALID_CHANGE",
    );
    assert.deepEqual(data(6).after, []);
    assert.ok(
      data(7).tickets.every(
        (ticket: { delivery_complete: boolean }) => ticket.delivery_complete,
      ),
    );
    assert.equal(data(8).events.length, 3);
    assert.equal(
      JSON.parse(results[9]!.stderr).data.error.code,
      "CONFIG_EXISTS",
    );
    assert.equal(JSON.parse(results[10]!.stderr).kind, "usageFailure");
    const manifest = data(11).manifest;
    for (const name of [
      "init",
      "check",
      "list",
      "setStatus",
      "setDeps",
      "history",
      "schema",
    ])
      assert.ok(manifest.commands[name]);
    assert.ok(results[12]!.stdout.includes("set-status"));
    assert.equal(
      results[13]!.stdout,
      `${identity.commandName} ${identity.version}\n`,
    );
    assert.equal(
      await readFile(path.join(context.workDir, "issues/01-first.md"), "utf8"),
      '---\nstatus: " done "\nblocked_by: []\n---\n正文。\n',
    );
    const config = JSON.parse(
      await readFile(path.join(context.workDir, "ticket-graph.json"), "utf8"),
    );
    assert.equal(
      config.$schema,
      `https://unpkg.com/@ykdz/tickets@${identity.version}/ticket-graph.schema.json`,
    );
    const schemaRoot =
      context.mode === "packed"
        ? process.env.TICKETS_PACKED_PACKAGE_ROOT!
        : context.packageRoot;
    const schema = JSON.parse(
      await readFile(path.join(schemaRoot, "ticket-graph.schema.json"), "utf8"),
    );
    const validate = new Ajv({ allErrors: true }).compile(schema);
    assert.equal(validate(config), true);
    assert.equal(validate({ ...config, completion: { values: [" "] } }), false);
  },
};

export default journey;

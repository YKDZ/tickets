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
        name: "Initialize",
        args: [
          "init",
          ...config,
          "--tickets",
          "issues",
          "--completion-value",
          " done ",
        ],
      },
      { name: "Check", args: ["check", ...config] },
      {
        name: "List blocked tickets",
        args: ["list", ...config, "--filter", "blocked"],
      },
      {
        name: "Update statuses",
        args: ["set-status", ...config, "01", "02", "--status", " done "],
      },
      {
        name: "Repeat status update",
        args: ["set-status", ...config, "01", "--status", " done "],
      },
      { name: "Reject a cycle", args: ["set-deps", ...config, "01", "02"] },
      {
        name: "Clear prerequisites",
        args: ["set-deps", ...config, "02", "--clear"],
      },
      { name: "List completed tickets", args: ["list", ...config] },
      { name: "Read history", args: ["history", ...config] },
      {
        name: "Reject config overwrite",
        args: [
          "init",
          ...config,
          "--tickets",
          "issues",
          "--completion-value",
          "done",
        ],
      },
      { name: "Report usage error", args: ["set-deps", ...config, "02"] },
      { name: "Discover command contracts", args: ["--schema"] },
      { name: "Show help", args: ["--help"] },
      { name: "Show version", args: ["--version"] },
      { name: "Discover input schema", args: ["set-deps", "--schema=input"] },
      {
        name: "Read a text result",
        args: ["check", ...config, "--output", "text"],
      },
      {
        name: "Discover check wire format",
        args: ["check", "--schema=wire:structured"],
      },
      {
        name: "Discover list success format",
        args: ["list", "--schema=success:structured"],
      },
      {
        name: "Initialize a second configuration in text mode",
        args: [
          "init",
          "--config",
          "alternate.json",
          "--tickets",
          "issues",
          "--completion-value",
          "done",
          "--output",
          "text",
        ],
      },
      {
        name: "List tickets in text mode",
        args: ["list", ...config, "--output", "text"],
      },
      {
        name: "Repeat a status in text mode",
        args: [
          "set-status",
          ...config,
          "01",
          "--status",
          " done ",
          "--output",
          "text",
        ],
      },
      {
        name: "Clear prerequisites in text mode",
        args: ["set-deps", ...config, "02", "--clear", "--output", "text"],
      },
      {
        name: "Read history in text mode",
        args: ["history", ...config, "--output", "text"],
      },
      {
        name: "Reject overwriting an existing configuration in text mode",
        args: [
          "init",
          ...config,
          "--tickets",
          "issues",
          "--completion-value",
          "done",
          "--output",
          "text",
        ],
      },
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
      const expected =
        index === 5 || index === 9 || index === 23 ? 1 : index === 10 ? 2 : 0;
      assert.equal(
        result.exitCode,
        expected,
        `${result.commandName}: ${result.stderr}`,
      );
      if (expected === 0) assert.equal(result.stderr, "");
      else assert.equal(result.stdout, "");
    }
    const initialized = JSON.parse(results[0]!.stdout);
    assert.equal(initialized.schemaVersion, "3");
    assert.equal(initialized.outputMode, "structured");
    assert.equal(initialized.data.created, true);
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
    const discovery = JSON.parse(results[11]!.stdout);
    assert.equal(discovery.kind, "directory");
    assert.equal(discovery.schemaVersion, "5");
    assert.deepEqual(
      discovery.children.map(({ path }: { path: string[] }) => path[0]).sort(),
      ["check", "history", "init", "list", "set-deps", "set-status"],
    );
    assert.ok(results[12]!.stdout.includes("set-status"));
    assert.equal(
      results[13]!.stdout,
      `${identity.commandName} ${identity.version}\n`,
    );
    assert.equal(
      await readFile(path.join(context.workDir, "issues/01-first.md"), "utf8"),
      '---\nstatus: " done "\nblocked_by: []\n---\n正文。\n',
    );
    assert.equal(JSON.parse(results[14]!.stdout).kind, "input");
    assert.match(results[15]!.stdout, /Checked 2 tickets/);
    assert.equal(JSON.parse(results[16]!.stdout).kind, "wire");
    assert.equal(JSON.parse(results[17]!.stdout).kind, "success");
    assert.match(results[18]!.stdout, /Created configuration/);
    assert.match(results[19]!.stdout, /02:  done  /);
    assert.match(results[20]!.stdout, /Ticket 01: unchanged/);
    assert.match(results[21]!.stdout, /Ticket 02: unchanged/);
    assert.match(results[22]!.stdout, /3 changes/);
    assert.match(results[23]!.stderr, /already exists/);
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

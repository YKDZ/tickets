import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import type { Completion } from "../../src/types.ts";
import { success, failure } from "./cli-output.ts";

const cli = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));

function fixture(
  t: TestContext,
  files: Record<string, string>,
  completion: Completion = { values: ["resolved"] },
) {
  const root = mkdtempSync(join(tmpdir(), "ticket-graph-validation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "issues"));
  const config = join(root, "ticket-graph.json");
  writeFileSync(config, JSON.stringify({ tickets: "issues", completion }));
  for (const [name, text] of Object.entries(files))
    writeFileSync(join(root, "issues", name), text);
  return { root, config, file: (name: string) => join(root, "issues", name) };
}

function ticket(status = "open", blockedBy: string[] = []) {
  return `---\nstatus: ${status}\nblocked_by: ${JSON.stringify(blockedBy)}\n---\n# 任务\n\n正文。\n`;
}

function run(f: { config: string }, ...args: string[]) {
  const result = spawnSync(
    process.execPath,
    [cli, args[0]!, "--config", f.config, ...args.slice(1)],
    { encoding: "utf8", cwd: tmpdir() },
  );
  assert.ifError(result.error);
  return result;
}

void test("Read machine fields from the front matter of a valid ticket graph", (t) => {
  const body = '\n```yaml\nstatus: broken\nblocked_by: ["missing"]\n```\n';
  const f = fixture(t, {
    "01-ready.md": ticket("resolved") + body,
    "02-next.md": ticket("open", ["01"]),
  });
  const result = run(f, "check");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const data = success(result.stdout);
  assert.equal(data.command, "check");
  assert.equal(data.valid, true);
  assert.equal(data.total, 2);
  assert.equal(
    readFileSync(f.file("01-ready.md"), "utf8"),
    ticket("resolved") + body,
  );
});

void test("Locate missing fields and reject corrupt dependency lists", (t) => {
  const original = "---\nstatus: open\n---\n# 任务\nblocked_by: []\n";
  const f = fixture(t, { "07-missing.md": original });
  for (const command of ["check", "list"]) {
    const result = run(f, command);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    const error = failure(result.stderr).error;
    assert.equal(error.code, "INVALID_GRAPH");
    const issue = error.issues.find((item) => item.code === "MISSING_FIELD");
    assert.ok(issue);
    assert.equal(issue.ticket, "07");
    assert.equal(issue.file, f.file("07-missing.md"));
    assert.equal(issue.field, "blocked_by");
  }
  assert.equal(readFileSync(f.file("07-missing.md"), "utf8"), original);
});

void test("Apply consistent rules to status strings and dependency arrays", (t) => {
  const f = fixture(t, {
    "01-number.md": "---\nstatus: 7\nblocked_by: []\n---\n",
    "02-scalar.md": '---\nstatus: open\nblocked_by: "01"\n---\n',
    "03-number-ref.md": "---\nstatus: open\nblocked_by: [1]\n---\n",
    "04-null.md": "---\nstatus: null\nblocked_by: null\n---\n",
  });
  const result = run(f, "check");
  assert.equal(result.status, 1);
  const error = failure(result.stderr).error;
  assert.equal(error.code, "INVALID_GRAPH");
  assert.deepEqual(
    error.issues.map((item) => [item.code, item.ticket, item.field]),
    [
      ["INVALID_FIELD", "01", "status"],
      ["INVALID_FIELD", "02", "blocked_by"],
      ["INVALID_FIELD", "03", "blocked_by"],
      ["INVALID_FIELD", "04", "status"],
      ["INVALID_FIELD", "04", "blocked_by"],
    ],
  );
});

void test("Require closed YAML front matter at the start of the file", (t) => {
  const f = fixture(t, {
    "01-body.md": `# 正文\n${ticket()}`,
    "02-unclosed.md": "---\nstatus: open\nblocked_by: []\n",
    "03-sequence.md": "---\n- open\n- []\n---\n",
    "04-broken.md": "---\nstatus: open\nblocked_by: [\n---\n",
  });
  const result = run(f, "check");
  assert.equal(result.status, 1);
  const error = failure(result.stderr).error;
  assert.equal(error.code, "INVALID_GRAPH");
  for (const [id, code] of [
    ["01", "MISSING_FRONTMATTER"],
    ["02", "UNCLOSED_FRONTMATTER"],
    ["03", "INVALID_FRONTMATTER"],
    ["04", "INVALID_YAML"],
  ]) {
    const item = error.issues.find((issue) => issue.ticket === id);
    assert.ok(item);
    assert.equal(item.code, code);
    assert.equal(typeof item.file, "string");
  }
});

void test("Locate duplicate fields and ticket IDs", (t) => {
  const f = fixture(t, {
    "01-a.md": ticket(),
    "01-b.md": ticket(),
    "02-duplicate.md":
      "---\nstatus: open\nblocked_by: []\nstatus: resolved\n---\n",
    "03-extra.md":
      "---\nstatus: open\nblocked_by: []\nowner: 张三\nowner: 李四\n---\n",
  });
  const result = run(f, "check");
  assert.equal(result.status, 1);
  const issues = failure(result.stderr).error.issues;
  assert.deepEqual(
    issues
      .filter((item) => item.code === "DUPLICATE_ID")
      .map((item) => item.file)
      .toSorted((a, b) => (a ?? "").localeCompare(b ?? "")),
    [f.file("01-a.md"), f.file("01-b.md")],
  );
  assert.deepEqual(
    issues
      .filter((item) => item.code === "DUPLICATE_FIELD")
      .map((item) => [item.ticket, item.field]),
    [
      ["02", "status"],
      ["03", "owner"],
    ],
  );
});

void test("Identify both ends of missing references and self-dependencies", (t) => {
  const f = fixture(t, {
    "01-missing.md": ticket("open", ["003"]),
    "02-self.md": ticket("open", ["02"]),
  });
  const result = run(f, "check");
  assert.equal(result.status, 1);
  const issues = failure(result.stderr).error.issues;
  assert.deepEqual(
    issues.map((item) => [item.code, item.ticket, item.target, item.field]),
    [
      ["MISSING_REFERENCE", "01", "003", "blocked_by"],
      ["SELF_DEPENDENCY", "02", "02", "blocked_by"],
    ],
  );
});

void test("Report cycles along actual dependency edges even for completed tickets", (t) => {
  const f = fixture(t, {
    "01-a.md": ticket("resolved", ["03"]),
    "02-b.md": ticket("open", ["01"]),
    "03-c.md": ticket("open", ["02"]),
  });
  const result = run(f, "check");
  assert.equal(result.status, 1);
  const cycle = failure(result.stderr).error.issues.find(
    (item) => item.code === "CYCLE",
  );
  assert.ok(cycle);
  assert.deepEqual(cycle.path, ["01", "03", "02", "01"]);
  assert.equal(cycle.field, "blocked_by");
  assert.equal(cycle.ticket, "01");
});

void test("Locate anchors and aliases in machine fields before editing", (t) => {
  const f = fixture(t, {
    "01-anchor.md":
      "---\nstatus: &state open\nblocked_by: []\nextra: *state\n---\n",
    "02-alias.md":
      "---\nextra: &state open\nstatus: *state\nblocked_by: []\n---\n",
    "03-nested-anchor.md":
      '---\nstatus: open\nblocked_by: [&dep "01"]\nextra: *dep\n---\n',
  });
  const result = run(f, "check");
  assert.equal(result.status, 1);
  const issues = failure(result.stderr).error.issues;
  assert.deepEqual(
    issues.map((item) => [item.code, item.ticket, item.field]),
    [
      ["UNSAFE_FIELD", "01", "status"],
      ["UNSAFE_FIELD", "02", "status"],
      ["UNSAFE_FIELD", "03", "blocked_by"],
    ],
  );
});

void test("Reject blank statuses and nonnumeric dependency IDs", (t) => {
  const f = fixture(t, {
    "01-blank.md": '---\nstatus: "  "\nblocked_by: []\n---\n',
    "02-nonnumeric.md": ticket("open", ["later"]),
  });
  const result = run(f, "check");
  assert.equal(result.status, 1);
  assert.deepEqual(
    failure(result.stderr).error.issues.map((item) => [
      item.code,
      item.ticket,
      item.field,
    ]),
    [
      ["INVALID_FIELD", "01", "status"],
      ["INVALID_FIELD", "02", "blocked_by"],
    ],
  );
});

void test("Preserve inline comments, other fields, body, and CRLF in a status edit", (t) => {
  const original =
    "---\r\nstatus: |- # 当前状态\r\n  open\r\nblocked_by: [] # 前置\r\nextra:\r\n  status: 保留\r\n---\r\n# 任务\r\n\r\nstatus: 正文保持原样\r\n";
  const f = fixture(t, { "01-block.md": original });
  const result = run(f, "set-status", "01", "--status", "resolved");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(success(result.stdout).results[0]!.changed, true);
  assert.equal(
    readFileSync(f.file("01-block.md"), "utf8"),
    '---\r\nstatus: "resolved" # 当前状态\r\nblocked_by: [] # 前置\r\nextra:\r\n  status: 保留\r\n---\r\n# 任务\r\n\r\nstatus: 正文保持原样\r\n',
  );
  const check = run(f, "check");
  assert.equal(check.status, 0, check.stderr);
});

void test("Preserve comments and metadata when replacing a dependency sequence", (t) => {
  const original =
    '---\nstatus: open\nblocked_by: # 前置说明\n  - "01"\n  - "02" # 尾注\n\n# 所有者说明\nowner: "张三"\n---\n正文\n';
  const f = fixture(t, {
    "01-a.md": ticket(),
    "02-b.md": ticket(),
    "03-block.md": original,
  });
  const result = run(f, "set-deps", "03", "02");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(f.file("03-block.md"), "utf8"),
    '---\nstatus: open\nblocked_by: # 前置说明\n  ["02"] # 尾注\n\n# 所有者说明\nowner: "张三"\n---\n正文\n',
  );
  assert.equal(run(f, "check").status, 0);
});

void test("Clear an unindented sequence while preserving CRLF and following fields", (t) => {
  const original =
    '---\r\nstatus: open\r\nblocked_by:\r\n- "01" # 前置\r\nowner: 张三\r\n---\r\n正文\r\n';
  const f = fixture(t, { "01-a.md": ticket(), "02-block.md": original });
  const result = run(f, "set-deps", "02", "--clear");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(f.file("02-block.md"), "utf8"),
    "---\r\nstatus: open\r\nblocked_by:\r\n  [] # 前置\r\nowner: 张三\r\n---\r\n正文\r\n",
  );
});

void test("Report remaining issues when removing an edge from an existing cycle", (t) => {
  const f = fixture(t, {
    "01-a.md": ticket("open", ["02", "03"]),
    "02-b.md": ticket("open", ["01"]),
    "03-c.md": ticket("open", ["04"]),
    "04-d.md": ticket("open", ["01", "03"]),
    "05-missing.md": ticket("open", ["99"]),
  });
  const result = run(f, "set-deps", "01", "02");
  assert.equal(result.status, 0, result.stderr);
  const data = success(result.stdout);
  assert.equal(data.changed, true);
  assert.deepEqual(
    data.issues
      .filter((item) => item.code === "CYCLE")
      .map((item) => item.path)
      .toSorted((a, b) =>
        (a ?? []).join(",").localeCompare((b ?? []).join(",")),
      ),
    [
      ["01", "02", "01"],
      ["03", "04", "03"],
    ],
  );
  assert.equal(
    data.issues.find((item) => item.code === "MISSING_REFERENCE")!.ticket,
    "05",
  );
  assert.equal(readFileSync(f.file("01-a.md"), "utf8"), ticket("open", ["02"]));
});

void test("Reject a new cycle edge between tickets already in a cycle", (t) => {
  const original = ticket("open", ["02"]);
  const f = fixture(t, {
    "01-a.md": original,
    "02-b.md": ticket("open", ["03"]),
    "03-c.md": ticket("open", ["01"]),
  });
  const result = run(f, "set-deps", "01", "02", "03");
  assert.equal(result.status, 1);
  const data = failure(result.stderr);
  assert.equal(data.error.code, "INVALID_CHANGE");
  assert.equal(
    data.error.issues.some((item) => item.code === "CYCLE"),
    true,
  );
  assert.equal(data.effects.ticketSaved, false);
  assert.equal(readFileSync(f.file("01-a.md"), "utf8"), original);
});

void test("Repair mapping-shaped dependencies while preserving other fields", (t) => {
  const original =
    "---\nstatus: open\nblocked_by:\n  wrong:\n    - true # 原值尾注\nowner: 张三\n---\n正文\n";
  const f = fixture(t, { "01-bad-type.md": original });
  const before = run(f, "check");
  assert.equal(failure(before.stderr).error.issues[0]!.code, "INVALID_FIELD");
  const result = run(f, "set-deps", "01", "--clear");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(f.file("01-bad-type.md"), "utf8"),
    "---\nstatus: open\nblocked_by:\n  [] # 原值尾注\nowner: 张三\n---\n正文\n",
  );
  assert.equal(run(f, "check").status, 0);
});

void test("Replace a block scalar dependency without consuming the next field", (t) => {
  const original =
    "---\nstatus: open\nblocked_by:\n  - |-\n    01\nowner: 张三\n---\n正文\n";
  const f = fixture(t, { "01-a.md": ticket(), "02-last-block.md": original });
  assert.equal(run(f, "check").status, 0);
  const result = run(f, "set-deps", "02", "--clear");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(f.file("02-last-block.md"), "utf8"),
    "---\nstatus: open\nblocked_by:\n  []\nowner: 张三\n---\n正文\n",
  );
});

void test("Repair null fields and preserve adjacent comments and blank lines", (t) => {
  const f = fixture(t, {
    "01-null.md": "---\nstatus:\n# 前置说明\nblocked_by: []\n---\n正文\n",
  });
  const result = run(f, "set-status", "01", "--status", "resolved");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(f.file("01-null.md"), "utf8"),
    '---\nstatus: "resolved"\n# 前置说明\nblocked_by: []\n---\n正文\n',
  );
});

void test("Preserve previous values in results and history when repairing field types", (t) => {
  for (const [yaml, previous] of [
    ["7", 7],
    [
      "{__proto__: {legacy: true}, constructor: test}",
      JSON.parse('{"__proto__":{"legacy":true},"constructor":"test"}'),
    ],
  ] as const) {
    const f = fixture(t, {
      "01-legacy.md": `---\nstatus: ${yaml}\nblocked_by: []\n---\n正文\n`,
    });
    const result = run(f, "set-status", "01", "--status", "resolved");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(success(result.stdout).results[0]!.before, previous);
    const history = run(f, "history", "--ticket", "01");
    assert.equal(history.status, 0, history.stderr);
    assert.deepEqual(success(history.stdout).events[0]!.before, previous);
  }
});

void test("Reject previous values that cannot be preserved in JSON history", (t) => {
  const original = "---\nstatus: .inf\nblocked_by: []\n---\n正文\n";
  const f = fixture(t, { "01-infinity.md": original });
  const result = run(f, "set-status", "01", "--status", "resolved");
  assert.equal(result.status, 1);
  assert.equal(failure(result.stderr).error.code, "UNEDITABLE_FIELD");
  assert.equal(readFileSync(f.file("01-infinity.md"), "utf8"), original);
});

void test("Reject lossy JSON conversion without appending history", (t) => {
  const cases = [
    '---\nstatus:\n  1: first\n  "1": second\nblocked_by: []\n---\n正文\n',
    "---\nstatus: 9007199254740993\nblocked_by: []\n---\n正文\n",
  ];
  for (const original of cases) {
    const f = fixture(t, { "01-lossy.md": original });
    const result = run(f, "set-status", "01", "--status", "resolved");
    assert.equal(result.status, 1, original);
    assert.equal(failure(result.stderr).error.code, "UNEDITABLE_FIELD");
    assert.equal(readFileSync(f.file("01-lossy.md"), "utf8"), original);
    const history = run(f, "history", "--ticket", "01");
    assert.equal(history.status, 0, history.stderr);
    assert.deepEqual(success(history.stdout).events, []);
  }
});

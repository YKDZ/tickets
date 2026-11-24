import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cliCommandIdentity } from "../../src/cli-command-identity.ts";

void describe("CLI command identity", () => {
  void it("derives command and unpublished version only from manifest facts", () => {
    assert.deepStrictEqual(
      cliCommandIdentity({ bin: { release: "./dist/cli.js" } }),
      { commandName: "release", version: "unpublished" },
    );
    assert.deepStrictEqual(
      cliCommandIdentity({
        bin: { ship: "./dist/cli.js" },
        version: "2.3.4",
      }),
      { commandName: "ship", version: "2.3.4" },
    );
  });

  void it("rejects malformed manifest identity facts", () => {
    assert.throws(() => cliCommandIdentity(null), /must be an object/);
    assert.throws(() => cliCommandIdentity({ bin: {} }), /exactly one bin/);
    assert.throws(
      () =>
        cliCommandIdentity({
          bin: { release: "./dist/cli.js", ship: "./dist/cli.js" },
        }),
      /exactly one bin/,
    );
    assert.throws(
      () => cliCommandIdentity({ bin: { release: "./src/cli.ts" } }),
      /must execute ".\/dist\/cli\.js"/,
    );
    assert.throws(
      () =>
        cliCommandIdentity({
          bin: { release: "./dist/cli.js" },
          version: 1,
        }),
      /version must be a non-empty string/,
    );
  });
});

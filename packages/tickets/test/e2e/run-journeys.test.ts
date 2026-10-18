import assert from "node:assert/strict";
import { test } from "node:test";

import { runJourneys } from "./run-journeys.ts";

for (const mode of ["source", "distribution"] as const) {
  void test(`runs all ${mode} CLI journeys`, { timeout: 180_000 }, async () => {
    const passed = await runJourneys({ mode });
    assert.notStrictEqual(passed.length, 0);
  });
}

if (process.env.TICKETS_PACKED_BIN) {
  void test("安装包通过同一票图旅程", { timeout: 180_000 }, async () => {
    const passed = await runJourneys({
      mode: "packed",
      packedBin: process.env.TICKETS_PACKED_BIN!,
    });
    assert.notStrictEqual(passed.length, 0);
  });
}

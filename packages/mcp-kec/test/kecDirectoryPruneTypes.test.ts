import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  loadDirectoryPruningModule,
  pruneBarrelPath,
  task60ModulesExist,
} from "./helpers/kecDirectoryPruneFixture.js";

describe("Task 60 package-local type and export boundary", () => {
  it("is RED until the Task 60 barrel exists", () => {
    expect(
      existsSync(pruneBarrelPath),
      "missing Task 60 package-local barrel",
    ).toBe(true);
  });

  it("exports only the four package-local discovery, planning, execution, and serialization authorities", async () => {
    if (!task60ModulesExist()) return;
    const loaded = await loadDirectoryPruningModule();
    expect(Object.keys(loaded).sort()).toEqual(
      [
        "discoverKecDirectoryPruneScope",
        "executeKecDirectoryPrune",
        "prepareKecDirectoryPrune",
        "serializeKecDirectoryPruneResult",
      ].sort(),
    );
    for (const value of Object.values(loaded))
      expect(value).toBeTypeOf("function");
  });
});

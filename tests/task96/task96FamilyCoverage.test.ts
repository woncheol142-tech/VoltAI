import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EXPECTED_TASK96_FAMILY_LABELS,
  TASK96_RED_FAMILY_MAP,
  workspaceRoot,
} from "./fixtures/task96ArchitectureContract.js";

describe("Task96 V4 RED family mapping prerequisite", () => {
  it("maps every A-BL family once to a concrete executable test case", () => {
    const observed = Object.keys(TASK96_RED_FAMILY_MAP);
    expect(observed).toEqual(EXPECTED_TASK96_FAMILY_LABELS);
    expect(observed).toHaveLength(64);
    expect(new Set(observed).size).toBe(64);

    const occurrences = new Map<string, number>();
    for (const [label, location] of Object.entries(TASK96_RED_FAMILY_MAP)) {
      const path = join(workspaceRoot, "tests/task96", location.file);
      const source = readFileSync(path, "utf8");
      const marker = `family("${label}"`;
      const count = source.split(marker).length - 1;
      occurrences.set(label, count);
      expect(location.case.length).toBeGreaterThan(0);
    }

    expect(
      [...occurrences.entries()].filter(([, count]) => count !== 1),
    ).toEqual([]);
  });
});

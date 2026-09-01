import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EXPECTED_TASK97_FAMILY_LABELS,
  TASK97_RED_FAMILY_MAP,
  task97Root,
} from "./fixtures/task97ArchitectureContract.js";

describe("Task97 V1 RED family mapping prerequisite", () => {
  it("maps exactly A-Z and AA-AH while retaining every prime matrix row as an independent test", () => {
    const labels = Object.keys(TASK97_RED_FAMILY_MAP);
    expect(labels).toEqual(EXPECTED_TASK97_FAMILY_LABELS);
    expect(labels).toHaveLength(34);
    expect(new Set(labels).size).toBe(34);

    const ownedTests = Object.entries(TASK97_RED_FAMILY_MAP).flatMap(
      ([label, family]) =>
        family.tests.map((test) => ({ label, family, test })),
    );
    expect(ownedTests).toHaveLength(38);
    expect(new Set(ownedTests.map(({ test }) => test.id)).size).toBe(38);

    for (const { label, family, test } of ownedTests) {
      expect(family.architectureSection.length).toBeGreaterThan(0);
      expect(family.expectedFailureCategory).toMatch(
        /^(EXPECTED_RED|PREREQUISITE_PASS|STRUCTURAL_RED)$/,
      );
      const source = readFileSync(join(task97Root, test.file), "utf8");
      const marker = `task97Contract("${label}", "${test.id}"`;
      expect(source.split(marker)).toHaveLength(2);
    }
  });
});

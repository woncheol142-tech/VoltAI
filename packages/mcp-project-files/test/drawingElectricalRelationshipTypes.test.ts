import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  ElectricalRelationship,
  ElectricalRelationshipDocument,
  ElectricalRelationshipJsonValue,
  ElectricalRelationshipStatistics,
  ElectricalRelationshipType,
} from "../src/drawingElectricalRelationships/types.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const typescriptCli = join(
  workspaceRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

const relationship = {
  relationshipId: "relationship-a",
  sourceObjectId: "object-a",
  targetObjectId: "object-b",
  relationshipType: "CONNECTED_TO" as ElectricalRelationshipType,
  confidence: 1,
  evidenceIds: ["evidence-a"],
  attributes: { circuit: "C1" },
  diagnostics: { ruleId: "fixture.relationship" },
} satisfies ElectricalRelationship;

const statistics = {
  relationshipCount: 1,
  relationshipCountByType: {
    CONNECTED_TO: 1,
    CONNECTED_VIA: 0,
    CONTAINS: 0,
    BELONGS_TO: 0,
    REFERENCES: 0,
    UNKNOWN: 0,
  },
} satisfies ElectricalRelationshipStatistics;

const document = {
  schemaVersion: 1,
  source: "docs/electrical.pdf",
  sourceSha256: "a".repeat(64),
  page: 15,
  objectIds: ["object-a", "object-b"],
  relationshipCount: 1,
  relationships: [relationship],
  statistics,
  warnings: [],
} satisfies ElectricalRelationshipDocument;

type RelationshipTypeModule = {
  ElectricalRelationshipType: Record<string, string>;
};

async function loadTypes(): Promise<RelationshipTypeModule> {
  const moduleUrl = new URL(
    "../src/drawingElectricalRelationships/types.ts",
    import.meta.url,
  );
  return import(/* @vite-ignore */ fileURLToPath(moduleUrl)) as Promise<
    RelationshipTypeModule
  >;
}

describe("electrical relationship public type contract", () => {
  it("compiles the schema-v1 relationship contract", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [
          typescriptCli,
          "--noEmit",
          "--strict",
          "--target",
          "ES2022",
          "--module",
          "NodeNext",
          "--moduleResolution",
          "NodeNext",
          "--skipLibCheck",
          testFile,
        ],
        { cwd: workspaceRoot, stdio: "pipe" },
      )
    ).not.toThrow();
  });

  it("fixes the six string enum values", async () => {
    const { ElectricalRelationshipType: types } = await loadTypes();
    expect(Object.values(types)).toEqual([
      "CONNECTED_TO",
      "CONNECTED_VIA",
      "CONTAINS",
      "BELONGS_TO",
      "REFERENCES",
      "UNKNOWN",
    ]);
  });

  it("fixes the relationship and document fields", async () => {
    await loadTypes();
    expectTypeOf<ElectricalRelationship>().toHaveProperty("relationshipId");
    expectTypeOf<ElectricalRelationship>().toHaveProperty("sourceObjectId");
    expectTypeOf<ElectricalRelationship>().toHaveProperty("targetObjectId");
    expectTypeOf<ElectricalRelationship>().toHaveProperty("relationshipType");
    expectTypeOf<ElectricalRelationship>().toHaveProperty("confidence");
    expectTypeOf<ElectricalRelationship>().toHaveProperty("evidenceIds");
    expectTypeOf<ElectricalRelationship>().toHaveProperty("attributes");
    expectTypeOf<ElectricalRelationship>().toHaveProperty("diagnostics");
    expectTypeOf<ElectricalRelationshipDocument>().toHaveProperty("objectIds");
    expectTypeOf<ElectricalRelationshipDocument>().toHaveProperty("relationships");
    expectTypeOf<ElectricalRelationshipDocument>().toHaveProperty("statistics");
    expectTypeOf<ElectricalRelationshipDocument>().toHaveProperty("warnings");
  });

  it("supports nested JSON values in attributes and diagnostics", async () => {
    await loadTypes();
    const value: ElectricalRelationshipJsonValue = {
      values: ["MCCB", 100, true, null],
    };
    expect(value).toEqual({ values: ["MCCB", 100, true, null] });
    expect(document.relationships[0]).toBe(relationship);
  });

  it("rejects unsupported compile-time shapes", async () => {
    await loadTypes();
    // @ts-expect-error relationship types are closed
    const invalidType: ElectricalRelationshipType = "FEEDS";
    // @ts-expect-error schema version 2 is unsupported
    const invalidVersion: ElectricalRelationshipDocument = { schemaVersion: 2 };
    // @ts-expect-error relationship IDs must be strings
    const invalidId: ElectricalRelationship = { ...relationship, relationshipId: 1 };
    const { statistics: omitted, ...withoutStatistics } = document;
    expect(omitted).toBe(statistics);
    // @ts-expect-error document statistics are required
    const missingStatistics: ElectricalRelationshipDocument = withoutStatistics;
    expect([invalidType, invalidVersion, invalidId, missingStatistics]).toHaveLength(4);
  });
});

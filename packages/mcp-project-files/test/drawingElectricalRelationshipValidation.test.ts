import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type ValidationResult = {
  valid: boolean;
  issues: Array<{ code: string }>;
};

type ValidationModule = {
  validateElectricalRelationshipDocument(document: unknown): ValidationResult;
  validateElectricalRelationships(document: unknown): void;
};

async function load(): Promise<ValidationModule> {
  const moduleUrl = new URL(
    "../src/drawingElectricalRelationships/validateElectricalRelationships.ts",
    import.meta.url,
  );
  return import(/* @vite-ignore */ fileURLToPath(moduleUrl)) as Promise<
    ValidationModule
  >;
}

function typeCounts() {
  return {
    CONNECTED_TO: 1,
    CONNECTED_VIA: 0,
    CONTAINS: 0,
    BELONGS_TO: 0,
    REFERENCES: 0,
    UNKNOWN: 0,
  };
}

function makeRelationshipDocument() {
  return {
    schemaVersion: 1,
    source: "docs/electrical.pdf",
    sourceSha256: "a".repeat(64),
    page: 15,
    objectIds: ["object-a", "object-b"],
    relationshipCount: 1,
    relationships: [{
      relationshipId: "relationship-a",
      sourceObjectId: "object-a",
      targetObjectId: "object-b",
      relationshipType: "CONNECTED_TO",
      confidence: 0.9,
      evidenceIds: ["evidence-a", "evidence-b"],
      attributes: { circuit: "C1" },
      diagnostics: { ruleId: "fixture.relationship", reasons: [] },
    }],
    statistics: {
      relationshipCount: 1,
      relationshipCountByType: typeCounts(),
    },
    warnings: [],
  };
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}

function issueCodes(result: ValidationResult): string[] {
  return result.issues.map(({ code }) => code);
}

describe("electrical relationship shape validation", () => {
  it("accepts a canonical document without mutation", async () => {
    const { validateElectricalRelationshipDocument } = await load();
    const document = makeRelationshipDocument();
    const before = structuredClone(document);
    deepFreeze(document);
    expect(validateElectricalRelationshipDocument(document)).toEqual({
      valid: true,
      issues: [],
    });
    expect(document).toEqual(before);
  });

  it("rejects a missing relationshipId", async () => {
    const { validateElectricalRelationshipDocument } = await load();
    const document = makeRelationshipDocument();
    Reflect.deleteProperty(document.relationships[0], "relationshipId");
    expect(issueCodes(validateElectricalRelationshipDocument(document)))
      .toContain("INVALID_RELATIONSHIP_ID");
  });

  it("rejects duplicate relationship IDs", async () => {
    const { validateElectricalRelationshipDocument } = await load();
    const document = makeRelationshipDocument();
    document.relationships.push(structuredClone(document.relationships[0]));
    document.relationshipCount = 2;
    document.statistics.relationshipCount = 2;
    document.statistics.relationshipCountByType.CONNECTED_TO = 2;
    expect(issueCodes(validateElectricalRelationshipDocument(document)))
      .toContain("DUPLICATE_RELATIONSHIP_ID");
  });

  it.each([
    ["source", "sourceObjectId", "DANGLING_SOURCE_OBJECT_REFERENCE"],
    ["target", "targetObjectId", "DANGLING_TARGET_OBJECT_REFERENCE"],
  ])("rejects a missing %s object", async (_name, field, code) => {
    const { validateElectricalRelationshipDocument } = await load();
    const document = makeRelationshipDocument();
    Reflect.set(document.relationships[0], field, "missing-object");
    expect(issueCodes(validateElectricalRelationshipDocument(document))).toContain(code);
  });

  it("rejects an unsupported relationship enum value", async () => {
    const { validateElectricalRelationshipDocument } = await load();
    const document = makeRelationshipDocument();
    document.relationships[0].relationshipType = "FEEDS";
    expect(issueCodes(validateElectricalRelationshipDocument(document)))
      .toContain("INVALID_RELATIONSHIP_TYPE");
  });

  it.each([-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid confidence %s",
    async (confidence) => {
      const { validateElectricalRelationshipDocument } = await load();
      const document = makeRelationshipDocument();
      document.relationships[0].confidence = confidence;
      expect(issueCodes(validateElectricalRelationshipDocument(document)))
        .toContain("INVALID_RELATIONSHIP_CONFIDENCE");
    },
  );

  it("rejects duplicate evidence IDs", async () => {
    const { validateElectricalRelationshipDocument } = await load();
    const document = makeRelationshipDocument();
    document.relationships[0].evidenceIds = ["evidence-a", "evidence-a"];
    expect(issueCodes(validateElectricalRelationshipDocument(document)))
      .toContain("DUPLICATE_EVIDENCE_ID");
  });

  it("rejects duplicate object registry IDs", async () => {
    const { validateElectricalRelationshipDocument } = await load();
    const document = makeRelationshipDocument();
    document.objectIds.push("object-a");
    expect(issueCodes(validateElectricalRelationshipDocument(document)))
      .toContain("DUPLICATE_OBJECT_ID");
  });

  it.each([
    ["Date", () => new Date("2026-01-02T03:04:05.000Z")],
    ["Map", () => new Map([["key", "value"]])],
    ["Set", () => new Set(["value"])],
    ["custom class instance", () => new (class Example { value = "x"; })()],
  ])("rejects a non-plain %s JSON value", async (_name, makeValue) => {
    const { validateElectricalRelationshipDocument } = await load();
    const document = makeRelationshipDocument();
    Reflect.set(document.relationships[0].attributes, "invalid", makeValue());
    const result = validateElectricalRelationshipDocument(document);
    expect(result.valid).toBe(false);
    expect(issueCodes(result)).toContain("INVALID_RELATIONSHIP_ATTRIBUTES");
  });

  it.each([
    ["empty hole", () => Array(1)],
    ["leading hole", () => {
      const value: unknown[] = [];
      value[1] = "x";
      return value;
    }],
    ["enumerable string property", () => {
      const value: unknown[] = ["x"];
      Reflect.set(value, "extra", "y");
      return value;
    }],
    ["symbol property", () => {
      const value: unknown[] = ["x"];
      Reflect.set(value, Symbol("private"), "y");
      return value;
    }],
  ])("rejects a non-dense array with %s", async (_name, makeValue) => {
    const { validateElectricalRelationshipDocument } = await load();
    const document = makeRelationshipDocument();
    Reflect.set(document.relationships[0].diagnostics, "invalid", makeValue());
    const result = validateElectricalRelationshipDocument(document);
    expect(result.valid).toBe(false);
    expect(issueCodes(result)).toContain("INVALID_RELATIONSHIP_DIAGNOSTICS");
  });

  it("accepts recursively JSON-safe dense arrays", async () => {
    const { validateElectricalRelationshipDocument } = await load();
    const document = makeRelationshipDocument();
    Reflect.set(
      document.relationships[0].attributes,
      "values",
      [null, true, 1, "x", { nested: [] }],
    );
    expect(validateElectricalRelationshipDocument(document)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("accepts object literals and null-prototype JSON objects", async () => {
    const { validateElectricalRelationshipDocument } = await load();
    const document = makeRelationshipDocument();
    const nullPrototype = Object.create(null) as Record<string, unknown>;
    nullPrototype.nested = { values: [null, "x"] };
    Reflect.set(document.relationships[0].attributes, "literal", {
      nested: { values: [true, 1] },
    });
    Reflect.set(document.relationships[0].diagnostics, "nullPrototype", nullPrototype);
    expect(validateElectricalRelationshipDocument(document)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("rejects relationshipCount mismatch", async () => {
    const { validateElectricalRelationshipDocument } = await load();
    const document = makeRelationshipDocument();
    document.relationshipCount = 2;
    expect(issueCodes(validateElectricalRelationshipDocument(document)))
      .toContain("RELATIONSHIP_COUNT_MISMATCH");
  });

  it("rejects relationshipCountByType mismatch", async () => {
    const { validateElectricalRelationshipDocument } = await load();
    const document = makeRelationshipDocument();
    document.statistics.relationshipCountByType.CONNECTED_TO = 0;
    expect(issueCodes(validateElectricalRelationshipDocument(document)))
      .toContain("RELATIONSHIP_TYPE_STATISTICS_MISMATCH");
  });

  it("provides a throwing validation boundary", async () => {
    const { validateElectricalRelationships } = await load();
    const document = makeRelationshipDocument();
    document.relationships[0].sourceObjectId = "missing-object";
    expect(() => validateElectricalRelationships(document)).toThrow(
      /source|object|relationship/i,
    );
  });
});

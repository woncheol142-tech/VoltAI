import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type SerializationModule = {
  serializeElectricalRelationshipDocument(document: unknown): string;
};

async function load(): Promise<SerializationModule> {
  const moduleUrl = new URL(
    "../src/drawingElectricalRelationships/serializeElectricalRelationships.ts",
    import.meta.url,
  );
  return import(/* @vite-ignore */ fileURLToPath(moduleUrl)) as Promise<
    SerializationModule
  >;
}

function typeCounts() {
  return {
    CONNECTED_TO: 1,
    CONNECTED_VIA: 0,
    CONTAINS: 0,
    BELONGS_TO: 0,
    REFERENCES: 1,
    UNKNOWN: 0,
  };
}

function makeRelationshipDocument() {
  return {
    schemaVersion: 1,
    source: "docs/전기 관계.pdf",
    sourceSha256: "a".repeat(64),
    page: 15,
    objectIds: ["object-a", "object-b", "object-c"],
    relationshipCount: 2,
    relationships: [{
      relationshipId: "relationship-a",
      sourceObjectId: "object-a",
      targetObjectId: "object-b",
      relationshipType: "CONNECTED_TO",
      confidence: 0.9,
      evidenceIds: ["evidence-a", "evidence-b"],
      attributes: { circuit: "C1", label: "간선" },
      diagnostics: { reasons: [], ruleId: "fixture.connected" },
    }, {
      relationshipId: "relationship-b",
      sourceObjectId: "object-b",
      targetObjectId: "object-c",
      relationshipType: "REFERENCES",
      confidence: 0.7,
      evidenceIds: ["evidence-c"],
      attributes: { note: "참조" },
      diagnostics: { reasons: [], ruleId: "fixture.reference" },
    }],
    statistics: {
      relationshipCount: 2,
      relationshipCountByType: typeCounts(),
    },
    warnings: ["경고 A", "경고 B"],
  };
}

function reverseRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).reverse());
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}

describe("electrical relationship serialization", () => {
  it("validates before producing bytes", async () => {
    const { serializeElectricalRelationshipDocument } = await load();
    const document = makeRelationshipDocument();
    document.relationships[1].relationshipId = "relationship-a";
    expect(() => serializeElectricalRelationshipDocument(document)).toThrow(
      /duplicate|relationship/i,
    );
  });

  it("projects only public document, relationship, and statistics fields", async () => {
    const { serializeElectricalRelationshipDocument } = await load();
    const baseline = makeRelationshipDocument();
    const document = structuredClone(baseline);
    Reflect.set(document, "resolverState", { private: true });
    Reflect.set(document.relationships[0], "__private", "private-relationship");
    Reflect.set(document.statistics, "__private", "private-statistics");
    const serialized = serializeElectricalRelationshipDocument(document);
    expect(serialized).toBe(serializeElectricalRelationshipDocument(baseline));
    expect(serialized).not.toMatch(/resolverState|__private|private-/u);
  });

  it("does not serialize symbol properties at any depth", async () => {
    const { serializeElectricalRelationshipDocument } = await load();
    const baseline = makeRelationshipDocument();
    const document = structuredClone(baseline);
    const privateSymbol = Symbol("private-relationship-state");
    Reflect.set(document, privateSymbol, "document");
    Reflect.set(document.relationships[0], privateSymbol, "relationship");
    Reflect.set(document.relationships[0].attributes, privateSymbol, "attributes");
    Reflect.set(document.relationships[0].diagnostics, privateSymbol, "diagnostics");
    Reflect.set(document.statistics, privateSymbol, "statistics");
    expect(serializeElectricalRelationshipDocument(document)).toBe(
      serializeElectricalRelationshipDocument(baseline),
    );
  });

  it("canonicalizes relationship, object, evidence, warning, and JSON-key order", async () => {
    const { serializeElectricalRelationshipDocument } = await load();
    const first = makeRelationshipDocument();
    const second = structuredClone(first);
    second.relationships.reverse();
    second.objectIds.reverse();
    second.warnings.reverse();
    for (const relationship of second.relationships) {
      relationship.evidenceIds.reverse();
      relationship.attributes = reverseRecord(relationship.attributes);
      relationship.diagnostics = reverseRecord(relationship.diagnostics) as {
        reasons: never[];
        ruleId: string;
      };
    }
    expect(serializeElectricalRelationshipDocument(second)).toBe(
      serializeElectricalRelationshipDocument(first),
    );
  });

  it("writes compact UTF-8 JSON with exactly one trailing LF", async () => {
    const { serializeElectricalRelationshipDocument } = await load();
    const serialized = serializeElectricalRelationshipDocument(
      makeRelationshipDocument(),
    );
    expect(serialized.endsWith("\n")).toBe(true);
    expect(serialized.endsWith("\n\n")).toBe(false);
    expect(serialized).not.toContain("\n  ");
    expect(serialized).toContain("전기 관계");
    expect(serialized).toContain("간선");
  });

  it("produces deterministic bytes without mutating frozen input", async () => {
    const { serializeElectricalRelationshipDocument } = await load();
    const document = makeRelationshipDocument();
    const before = structuredClone(document);
    deepFreeze(document);
    const first = serializeElectricalRelationshipDocument(document);
    const second = serializeElectricalRelationshipDocument(document);
    expect(second).toBe(first);
    expect(document).toEqual(before);
  });
});

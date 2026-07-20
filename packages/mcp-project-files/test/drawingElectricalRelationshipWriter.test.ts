import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

type WriterModule = {
  writeElectricalRelationshipDocument(
    projectRoot: string,
    document: unknown,
    outputName: string,
  ): string;
};

type SerializationModule = {
  serializeElectricalRelationshipDocument(document: unknown): string;
};

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "voltai-relationship-test-"));
  roots.push(root);
  return root;
}

async function load(): Promise<WriterModule & SerializationModule> {
  const writerUrl = new URL(
    "../src/drawingElectricalRelationships/writeElectricalRelationships.ts",
    import.meta.url,
  );
  const serializerUrl = new URL(
    "../src/drawingElectricalRelationships/serializeElectricalRelationships.ts",
    import.meta.url,
  );
  const [writer, serializer] = await Promise.all([
    import(/* @vite-ignore */ fileURLToPath(writerUrl)),
    import(/* @vite-ignore */ fileURLToPath(serializerUrl)),
  ]);
  return { ...writer, ...serializer } as WriterModule & SerializationModule;
}

function makeRelationshipDocument() {
  return {
    schemaVersion: 1,
    source: "docs/전기 관계.pdf",
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
      evidenceIds: ["evidence-a"],
      attributes: { label: "간선" },
      diagnostics: { ruleId: "fixture.relationship", reasons: [] },
    }],
    statistics: {
      relationshipCount: 1,
      relationshipCountByType: {
        CONNECTED_TO: 1,
        CONNECTED_VIA: 0,
        CONTAINS: 0,
        BELONGS_TO: 0,
        REFERENCES: 0,
        UNKNOWN: 0,
      },
    },
    warnings: [],
  };
}

describe("electrical relationship persistence", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes deterministic serializer bytes to the schema path", async () => {
    const { writeElectricalRelationshipDocument, serializeElectricalRelationshipDocument } =
      await load();
    const root = tempRoot();
    const document = makeRelationshipDocument();
    const sourceHash = createHash("sha256")
      .update(document.source, "utf8")
      .digest("hex")
      .slice(0, 12);
    const firstPath = writeElectricalRelationshipDocument(root, document, "관계 결과");
    const firstBytes = readFileSync(join(root, firstPath));
    const secondPath = writeElectricalRelationshipDocument(
      root,
      structuredClone(document),
      "관계 결과",
    );
    const secondBytes = readFileSync(join(root, secondPath));
    expect(firstPath).toBe(
      `.volt-ai/electrical-relationships/관계_결과-${sourceHash}-page-015.json`,
    );
    expect(secondPath).toBe(firstPath);
    expect(secondBytes.equals(firstBytes)).toBe(true);
    expect(firstBytes.toString("utf8")).toBe(
      serializeElectricalRelationshipDocument(document),
    );
  });

  it.each([
    ["", /outputName/i],
    ["   ", /outputName/i],
    [".hidden", /hidden|outputName/i],
    ["../escape", /separator|outputName|path/i],
    ["nested/name", /separator|outputName/i],
    ["nested\\name", /separator|outputName/i],
    ["/absolute", /absolute|separator|outputName/i],
  ])("rejects unsafe outputName %j", async (outputName, message) => {
    const { writeElectricalRelationshipDocument } = await load();
    expect(() => writeElectricalRelationshipDocument(
      tempRoot(),
      makeRelationshipDocument(),
      outputName,
    )).toThrow(message);
  });

  it("rejects parent and target symlinks", async () => {
    const { writeElectricalRelationshipDocument } = await load();
    const root = tempRoot();
    const outside = tempRoot();
    const document = makeRelationshipDocument();
    symlinkSync(outside, join(root, ".volt-ai"));
    expect(() => writeElectricalRelationshipDocument(root, document, "relations"))
      .toThrow(/symbolic/i);

    rmSync(join(root, ".volt-ai"));
    const target = writeElectricalRelationshipDocument(root, document, "relations");
    const absolute = join(root, target);
    const outsideFile = join(outside, "outside.json");
    writeFileSync(outsideFile, "{}\n");
    rmSync(absolute);
    symlinkSync(outsideFile, absolute);
    expect(() => writeElectricalRelationshipDocument(root, document, "relations"))
      .toThrow(/symbolic/i);
  });

  it("atomically overwrites a regular file and cleans temporary files", async () => {
    const { writeElectricalRelationshipDocument } = await load();
    const root = tempRoot();
    const document = makeRelationshipDocument();
    const target = writeElectricalRelationshipDocument(root, document, "relations");
    const absolute = join(root, target);
    writeFileSync(absolute, "stale\n");
    expect(writeElectricalRelationshipDocument(root, document, "relations"))
      .toBe(target);
    expect(readFileSync(absolute, "utf8")).not.toBe("stale\n");
    expect(readdirSync(dirname(absolute)).filter((name) => name.endsWith(".tmp")))
      .toEqual([]);
  });

  it("rejects a directory target and cleans temporary files", async () => {
    const { writeElectricalRelationshipDocument } = await load();
    const root = tempRoot();
    const document = makeRelationshipDocument();
    const target = writeElectricalRelationshipDocument(root, document, "relations");
    const absolute = join(root, target);
    rmSync(absolute);
    mkdirSync(absolute);
    expect(() => writeElectricalRelationshipDocument(root, document, "relations"))
      .toThrow(/regular|file/i);
    expect(readdirSync(dirname(absolute)).filter((name) => name.endsWith(".tmp")))
      .toEqual([]);
  });

  it("validates before creating output directories or files", async () => {
    const { writeElectricalRelationshipDocument } = await load();
    const root = tempRoot();
    const document = makeRelationshipDocument();
    document.relationshipCount = 2;
    expect(() => writeElectricalRelationshipDocument(root, document, "invalid"))
      .toThrow(/count|relationship/i);
    expect(readdirSync(root)).toEqual([]);
  });

  it("does not add a persistence path to the stored document", async () => {
    const { writeElectricalRelationshipDocument } = await load();
    const root = tempRoot();
    const target = writeElectricalRelationshipDocument(
      root,
      makeRelationshipDocument(),
      "relations",
    );
    expect(existsSync(join(root, target))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, target), "utf8")))
      .not.toHaveProperty("relativeRelationshipPath");
  });
});

import { afterEach, describe, expect, it } from "vitest";

import {
  inspectKecIndex,
  serializeKecIndexDiagnostics,
  type KecIndexDiagnosticsV1,
} from "../src/indexDiagnostics/index.js";
import {
  createChunksOnlyIndexFixture,
  createEmptyIndexFixture,
  createInvalidSourcePathFixture,
  createMalformedEmbeddingFixture,
  createMalformedMetadataFixture,
  createMalformedSchemaFixture,
  createMetadataDimensionMismatchFixture,
  createMetadataOnlyIndexFixture,
  createMissingDatabaseFixture,
  createMixedDimensionsFixture,
  createMultipleSourcesIndexFixture,
  createPartialSchemaFixture,
  createReadyIndexFixture,
  createUninitializedDatabaseFixture,
  diagnosticMetadata,
  expectedSourceId,
  firstSourcePath,
  secondSourcePath,
  snapshotArtifacts,
  type KecIndexDiagnosticsFixture,
} from "./helpers/kecIndexDiagnosticsFixture.js";

const rootKeys = [
  "schemaVersion",
  "status",
  "databaseExists",
  "databaseSchemaVersion",
  "metadata",
  "chunkCount",
  "sourceCount",
  "sources",
  "observedDimensions",
  "issues",
];
const metadataKeys = ["provider", "model", "dimensions", "indexedAt"];
const sourceKeys = ["sourceId", "chunkCount"];
const nullMetadata = {
  provider: null,
  model: null,
  dimensions: null,
  indexedAt: null,
};
const fixtures: KecIndexDiagnosticsFixture[] = [];

function useFixture<T extends KecIndexDiagnosticsFixture>(fixture: T): T {
  fixtures.push(fixture);
  return fixture;
}

afterEach(() => {
  for (const fixture of fixtures.splice(0).reverse()) {
    fixture.cleanup();
  }
});

function expectExactKeys(diagnostics: KecIndexDiagnosticsV1): void {
  expect(Object.keys(diagnostics)).toEqual(rootKeys);
  expect(Object.keys(diagnostics.metadata)).toEqual(metadataKeys);
  for (const source of diagnostics.sources) {
    expect(Object.keys(source)).toEqual(sourceKeys);
  }
}

describe("KEC index diagnostics status behavior", () => {
  it.each([false, true])(
    "returns an exact non-creating MISSING_DATABASE result when parentExists=%s",
    async (parentExists) => {
      const fixture = useFixture(createMissingDatabaseFixture(parentExists));
      const before = snapshotArtifacts(fixture.databasePath);

      const diagnostics = await inspectKecIndex(fixture.databasePath);

      expect(diagnostics).toEqual({
        schemaVersion: 1,
        status: "MISSING_DATABASE",
        databaseExists: false,
        databaseSchemaVersion: null,
        metadata: nullMetadata,
        chunkCount: 0,
        sourceCount: 0,
        sources: [],
        observedDimensions: [],
        issues: [],
      });
      expect(snapshotArtifacts(fixture.databasePath)).toEqual(before);
      expectExactKeys(diagnostics);
    },
  );

  it("reports an empty SQLite file as UNINITIALIZED without migration", async () => {
    const fixture = useFixture(createUninitializedDatabaseFixture());
    const before = snapshotArtifacts(fixture.databasePath);

    const diagnostics = await inspectKecIndex(fixture.databasePath);

    expect(diagnostics).toEqual({
      schemaVersion: 1,
      status: "UNINITIALIZED_DATABASE",
      databaseExists: true,
      databaseSchemaVersion: 0,
      metadata: nullMetadata,
      chunkCount: 0,
      sourceCount: 0,
      sources: [],
      observedDimensions: [],
      issues: [],
    });
    expect(snapshotArtifacts(fixture.databasePath)).toEqual(before);
    expectExactKeys(diagnostics);
  });

  it("reports a partial required schema as INCONSISTENT", async () => {
    const fixture = useFixture(createPartialSchemaFixture());
    const before = snapshotArtifacts(fixture.databasePath);

    const diagnostics = await inspectKecIndex(fixture.databasePath);

    expect(diagnostics).toEqual({
      schemaVersion: 1,
      status: "INCONSISTENT",
      databaseExists: true,
      databaseSchemaVersion: 0,
      metadata: nullMetadata,
      chunkCount: 0,
      sourceCount: 0,
      sources: [],
      observedDimensions: [],
      issues: ["SCHEMA_INCOMPLETE"],
    });
    expect(snapshotArtifacts(fixture.databasePath)).toEqual(before);
    expectExactKeys(diagnostics);
  });

  it("reports a fully initialized index with no chunks or metadata as EMPTY_INDEX", async () => {
    const fixture = useFixture(createEmptyIndexFixture());

    await expect(inspectKecIndex(fixture.databasePath)).resolves.toEqual({
      schemaVersion: 1,
      status: "EMPTY_INDEX",
      databaseExists: true,
      databaseSchemaVersion: 1,
      metadata: nullMetadata,
      chunkCount: 0,
      sourceCount: 0,
      sources: [],
      observedDimensions: [],
      issues: [],
    });
  });

  it("reports a valid initialized index as READY using collection-level metadata", async () => {
    const fixture = useFixture(createReadyIndexFixture());
    const diagnostics = await inspectKecIndex(fixture.databasePath);

    expect(diagnostics).toEqual({
      schemaVersion: 1,
      status: "READY",
      databaseExists: true,
      databaseSchemaVersion: 1,
      metadata: diagnosticMetadata,
      chunkCount: 1,
      sourceCount: 1,
      sources: [
        {
          sourceId: expectedSourceId(firstSourcePath),
          chunkCount: 1,
        },
      ],
      observedDimensions: [3],
      issues: [],
    });
    expectExactKeys(diagnostics);
  });
});

describe("KEC index diagnostics inconsistent states", () => {
  it.each([
    {
      name: "metadata without chunks",
      factory: createMetadataOnlyIndexFixture,
      issues: ["METADATA_WITHOUT_CHUNKS"],
      dimensions: [],
    },
    {
      name: "chunks without metadata",
      factory: createChunksOnlyIndexFixture,
      issues: ["CHUNKS_WITHOUT_METADATA"],
      dimensions: [3],
    },
    {
      name: "malformed metadata",
      factory: createMalformedMetadataFixture,
      issues: ["INVALID_METADATA"],
      dimensions: [3],
    },
    {
      name: "malformed schema",
      factory: createMalformedSchemaFixture,
      issues: ["SCHEMA_INCOMPLETE"],
      dimensions: [],
    },
    {
      name: "malformed embedding JSON",
      factory: () => createMalformedEmbeddingFixture("not-json"),
      issues: ["INVALID_EMBEDDING"],
      dimensions: [],
    },
    {
      name: "non-array embedding",
      factory: () => createMalformedEmbeddingFixture('{"value":1}'),
      issues: ["INVALID_EMBEDDING"],
      dimensions: [],
    },
    {
      name: "empty embedding",
      factory: () => createMalformedEmbeddingFixture("[]"),
      issues: ["INVALID_EMBEDDING"],
      dimensions: [],
    },
    {
      name: "non-number embedding element",
      factory: () => createMalformedEmbeddingFixture('[1,"2",3]'),
      issues: ["INVALID_EMBEDDING"],
      dimensions: [],
    },
    {
      name: "non-finite decoded embedding element",
      factory: () => createMalformedEmbeddingFixture("[1e999]"),
      issues: ["INVALID_EMBEDDING"],
      dimensions: [],
    },
    {
      name: "mixed dimensions",
      factory: createMixedDimensionsFixture,
      issues: ["MIXED_EMBEDDING_DIMENSIONS"],
      dimensions: [2, 3],
    },
    {
      name: "metadata dimension mismatch",
      factory: createMetadataDimensionMismatchFixture,
      issues: ["METADATA_DIMENSION_MISMATCH"],
      dimensions: [3],
    },
    {
      name: "invalid source path",
      factory: createInvalidSourcePathFixture,
      issues: ["INVALID_SOURCE_PATH"],
      dimensions: [3],
    },
  ])(
    "reports $name as INCONSISTENT",
    async ({ factory, issues, dimensions }) => {
      const fixture = useFixture(factory());
      const diagnostics = await inspectKecIndex(fixture.databasePath);

      expect(diagnostics.status).toBe("INCONSISTENT");
      expect(diagnostics.issues).toEqual(issues);
      expect(diagnostics.observedDimensions).toEqual(dimensions);
    },
  );

  it("uses a fixed authority order when more than one issue applies", async () => {
    const fixture = useFixture(createChunksOnlyIndexFixture());
    const { DatabaseSync } =
      await import("./helpers/kecIndexDiagnosticsFixture.js");
    const database = new DatabaseSync(fixture.databasePath);
    database.prepare("UPDATE kec_chunks SET embedding = ?").run("[]");
    database.close();

    const diagnostics = await inspectKecIndex(fixture.databasePath);

    expect(diagnostics.issues).toEqual([
      "CHUNKS_WITHOUT_METADATA",
      "INVALID_EMBEDDING",
    ]);
  });
});

describe("KEC index diagnostics source redaction and determinism", () => {
  it("groups exact source strings, hashes them fully, and sorts by sourceId", async () => {
    const fixture = useFixture(createMultipleSourcesIndexFixture());
    const diagnostics = await inspectKecIndex(fixture.databasePath);
    const expected = [
      { sourceId: expectedSourceId(firstSourcePath), chunkCount: 2 },
      { sourceId: expectedSourceId(secondSourcePath), chunkCount: 1 },
    ].sort((left, right) =>
      left.sourceId < right.sourceId
        ? -1
        : left.sourceId > right.sourceId
          ? 1
          : 0,
    );

    expect(diagnostics.sourceCount).toBe(2);
    expect(diagnostics.sources).toEqual(expected);
    for (const source of diagnostics.sources) {
      expect(source.sourceId).toMatch(/^kecsrc_[0-9a-f]{64}$/u);
    }

    const serialized = serializeKecIndexDiagnostics(diagnostics);
    expect(serialized).not.toContain(firstSourcePath);
    expect(serialized).not.toContain(secondSourcePath);
    expect(serialized).not.toContain("kec-main.pdf");
    expect(serialized).not.toContain("kec-supplement.pdf");
  });

  it("returns fresh deeply frozen results and stable bytes across 100 inspections", async () => {
    const fixture = useFixture(createMultipleSourcesIndexFixture());
    const results = await Promise.all(
      Array.from({ length: 100 }, () => inspectKecIndex(fixture.databasePath)),
    );
    const serialized = results.map(serializeKecIndexDiagnostics);

    expect(new Set(serialized)).toEqual(new Set([serialized[0]]));
    expect(results.slice(1).every((result) => result !== results[0])).toBe(
      true,
    );
    expect(results.every((result) => Object.isFrozen(result))).toBe(true);
    expect(results.every((result) => Object.isFrozen(result.metadata))).toBe(
      true,
    );
    expect(results.every((result) => Object.isFrozen(result.sources))).toBe(
      true,
    );
    expect(
      results.every((result) => result.sources.every(Object.isFrozen)),
    ).toBe(true);
    expect(
      results.every((result) => Object.isFrozen(result.observedDimensions)),
    ).toBe(true);
    expect(results.every((result) => Object.isFrozen(result.issues))).toBe(
      true,
    );
  });

  it("blocks nested mutation attempts", async () => {
    const fixture = useFixture(createReadyIndexFixture());
    const diagnostics = await inspectKecIndex(fixture.databasePath);

    expect(() => {
      (diagnostics as { status: string }).status = "CHANGED";
    }).toThrow(TypeError);
    expect(() => {
      (diagnostics.metadata as { provider: string | null }).provider =
        "changed";
    }).toThrow(TypeError);
    expect(() => {
      (diagnostics.sources as Array<unknown>).push({});
    }).toThrow(TypeError);
    expect(() => {
      (diagnostics.sources[0] as { chunkCount: number }).chunkCount = 99;
    }).toThrow(TypeError);
    expect(() => {
      (diagnostics.observedDimensions as number[]).push(99);
    }).toThrow(TypeError);
    expect(() => {
      (diagnostics.issues as string[]).push("CHANGED");
    }).toThrow(TypeError);
  });

  it("serializes compact exact-key JSON with one LF without mutating input", async () => {
    const fixture = useFixture(createReadyIndexFixture());
    const diagnostics = await inspectKecIndex(fixture.databasePath);
    const before = structuredClone(diagnostics);
    const expected = `${JSON.stringify(diagnostics)}\n`;

    const serialized = serializeKecIndexDiagnostics(diagnostics);

    expect(serialized).toBe(expected);
    expect(serialized.endsWith("\n")).toBe(true);
    expect(serialized.endsWith("\n\n")).toBe(false);
    expect(serialized).not.toContain("\r");
    expect(serialized).not.toContain("\n ");
    expect(diagnostics).toEqual(before);
    expectExactKeys(JSON.parse(serialized) as KecIndexDiagnosticsV1);
  });
});

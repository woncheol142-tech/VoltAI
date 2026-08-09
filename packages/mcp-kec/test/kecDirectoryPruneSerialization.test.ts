import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  expectedPruneSourceId,
  loadDirectoryPruningModule,
  pruneBarrelPath,
  pruneErrors,
  task60ModulesExist,
  type KecDirectoryPruneResult,
} from "./helpers/kecDirectoryPruneFixture.js";

function result(sourcePaths: readonly string[] = []): KecDirectoryPruneResult {
  return Object.freeze({
    schemaVersion: 1,
    status: "SUCCEEDED" as const,
    desiredSourceCount: 2,
    indexedSourceCount: 2 + sourcePaths.length,
    deletedSourceCount: sourcePaths.length,
    sources: Object.freeze(
      sourcePaths.map((sourcePath) =>
        Object.freeze({
          sourceId: expectedPruneSourceId(sourcePath),
          status: "DELETED" as const,
        }),
      ),
    ),
  });
}

describe("Task 60 public result serialization", () => {
  it("is RED until the Task 60 serializer exists", () => {
    expect(existsSync(pruneBarrelPath), "missing Task 60 serializer").toBe(
      true,
    );
  });

  it("serializes the exact success shape as one compact LF-terminated JSON record", async () => {
    if (!task60ModulesExist()) return;
    const { serializeKecDirectoryPruneResult } =
      await loadDirectoryPruningModule();
    const value = result(["manuals/stale.pdf"]);
    const serialized = serializeKecDirectoryPruneResult(value);

    expect(serialized).toBe(`${JSON.stringify(value)}\n`);
    expect(Object.keys(JSON.parse(serialized) as object)).toEqual([
      "schemaVersion",
      "status",
      "desiredSourceCount",
      "indexedSourceCount",
      "deletedSourceCount",
      "sources",
    ]);
    expect(serialized).not.toContain("\r");
  });

  it("produces byte-identical output for equivalent starting state", async () => {
    if (!task60ModulesExist()) return;
    const { serializeKecDirectoryPruneResult } =
      await loadDirectoryPruningModule();
    const value = result(["manuals/a.pdf", "manuals/b.pdf"]);
    const bytes = Array.from({ length: 20 }, () =>
      serializeKecDirectoryPruneResult(structuredClone(value)),
    );
    expect(new Set(bytes).size).toBe(1);
  });

  it("serializes no-stale success with an empty source list", async () => {
    if (!task60ModulesExist()) return;
    const { serializeKecDirectoryPruneResult } =
      await loadDirectoryPruningModule();
    expect(JSON.parse(serializeKecDirectoryPruneResult(result()))).toEqual({
      schemaVersion: 1,
      status: "SUCCEEDED",
      desiredSourceCount: 2,
      indexedSourceCount: 2,
      deletedSourceCount: 0,
      sources: [],
    });
  });

  it("accepts more desired sources than indexed sources when nothing is stale", async () => {
    if (!task60ModulesExist()) return;
    const { serializeKecDirectoryPruneResult } =
      await loadDirectoryPruningModule();
    const value: KecDirectoryPruneResult = Object.freeze({
      schemaVersion: 1,
      status: "SUCCEEDED",
      desiredSourceCount: 2,
      indexedSourceCount: 1,
      deletedSourceCount: 0,
      sources: Object.freeze([]),
    });

    expect(JSON.parse(serializeKecDirectoryPruneResult(value))).toEqual(value);
  });

  it("accepts more desired sources than indexed sources after deleting one stale source", async () => {
    if (!task60ModulesExist()) return;
    const { serializeKecDirectoryPruneResult } =
      await loadDirectoryPruningModule();
    const staleSourceId = expectedPruneSourceId("manuals/stale.pdf");
    const value: KecDirectoryPruneResult = Object.freeze({
      schemaVersion: 1,
      status: "SUCCEEDED",
      desiredSourceCount: 2,
      indexedSourceCount: 1,
      deletedSourceCount: 1,
      sources: Object.freeze([
        Object.freeze({ sourceId: staleSourceId, status: "DELETED" }),
      ]),
    });

    expect(JSON.parse(serializeKecDirectoryPruneResult(value))).toEqual(value);
  });

  it("never exposes raw paths, database details, PDF text, vectors, or provider data", async () => {
    if (!task60ModulesExist()) return;
    const { serializeKecDirectoryPruneResult } =
      await loadDirectoryPruningModule();
    const serialized = serializeKecDirectoryPruneResult(
      result(["private/manuals/customer-secret.pdf"]),
    );
    for (const forbidden of [
      "private/manuals",
      "customer-secret.pdf",
      "kec.sqlite",
      "SQLITE",
      "embedding",
      "ollama",
      "PDF",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it.each([
    { ...result(), schemaVersion: 2 },
    { ...result(), status: "PARTIAL" },
    { ...result(), deletedSourceCount: 1 },
    {
      ...result(["manuals/a.pdf"]),
      sources: [{ sourceId: "not-a-source-id", status: "DELETED" }],
    },
  ])("rejects malformed result objects with INTERNAL_ERROR", async (value) => {
    if (!task60ModulesExist()) return;
    const { serializeKecDirectoryPruneResult } =
      await loadDirectoryPruningModule();
    expect(() =>
      serializeKecDirectoryPruneResult(
        value as unknown as KecDirectoryPruneResult,
      ),
    ).toThrow(pruneErrors.internalError);
  });
});

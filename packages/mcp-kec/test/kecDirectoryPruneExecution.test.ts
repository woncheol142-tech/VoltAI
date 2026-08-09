import { existsSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  captureAsyncErrorMessage,
  createPlan,
  expectedPruneSourceId,
  loadDirectoryPruningModule,
  pruneBarrelPath,
  pruneErrors,
  sourceIdOrder,
  task60ModulesExist,
} from "./helpers/kecDirectoryPruneFixture.js";

describe("Task 60 deterministic prune execution", () => {
  it("is RED until the Task 60 executor exists", () => {
    expect(existsSync(pruneBarrelPath), "missing Task 60 prune executor").toBe(
      true,
    );
  });

  it("returns success without opening a write transaction when there is no stale source", async () => {
    if (!task60ModulesExist()) return;
    const { executeKecDirectoryPrune } = await loadDirectoryPruningModule();
    const pruneSources = vi.fn(async () => {});
    const result = await executeKecDirectoryPrune(
      createPlan({
        staleSources: Object.freeze([]),
        indexedSourceCount: 1,
      }),
      Object.freeze({ pruneSources }),
    );

    expect(pruneSources).not.toHaveBeenCalled();
    expect(result).toEqual({
      schemaVersion: 1,
      status: "SUCCEEDED",
      desiredSourceCount: 1,
      indexedSourceCount: 1,
      deletedSourceCount: 0,
      sources: [],
    });
  });

  it("passes the complete expected snapshot and stale paths in sourceId order", async () => {
    if (!task60ModulesExist()) return;
    const { executeKecDirectoryPrune } = await loadDirectoryPruningModule();
    const stalePaths = ["manuals/zeta.pdf", "manuals/alpha.pdf"];
    const staleSources = stalePaths
      .map((sourcePath) => ({
        sourcePath,
        sourceId: expectedPruneSourceId(sourcePath),
      }))
      .sort((left, right) =>
        left.sourceId < right.sourceId
          ? -1
          : left.sourceId > right.sourceId
            ? 1
            : 0,
      );
    const expectedSnapshot = Object.freeze([
      "manuals/active.pdf",
      ...stalePaths,
      "other/retained.pdf",
    ]);
    const pruneSources = vi.fn(async () => {});

    const result = await executeKecDirectoryPrune(
      createPlan({
        expectedSourcePaths: expectedSnapshot,
        staleSources: Object.freeze(staleSources.map(Object.freeze)),
        indexedSourceCount: 3,
      }),
      Object.freeze({ pruneSources }),
    );

    expect(pruneSources).toHaveBeenCalledOnce();
    expect(pruneSources).toHaveBeenCalledWith(
      expectedSnapshot,
      staleSources.map((source) => source.sourcePath),
    );
    expect(result.sources.map((source) => source.sourceId)).toEqual(
      sourceIdOrder(stalePaths),
    );
    expect(result).toMatchObject({
      status: "SUCCEEDED",
      desiredSourceCount: 1,
      indexedSourceCount: 3,
      deletedSourceCount: 2,
    });
  });

  it("maps an atomic snapshot mismatch to INDEX_CHANGED without partial result", async () => {
    if (!task60ModulesExist()) return;
    const { executeKecDirectoryPrune } = await loadDirectoryPruningModule();
    const message = await captureAsyncErrorMessage(() =>
      executeKecDirectoryPrune(
        createPlan(),
        Object.freeze({
          pruneSources: async () => {
            throw new Error(pruneErrors.indexChanged);
          },
        }),
      ),
    );
    expect(message).toBe(pruneErrors.indexChanged);
  });

  it("maps unknown transactional failures to PRUNE_FAILED without leaking details", async () => {
    if (!task60ModulesExist()) return;
    const { executeKecDirectoryPrune } = await loadDirectoryPruningModule();
    const secret = "/private/project/manuals/stale.pdf SQLITE_CONSTRAINT";
    const message = await captureAsyncErrorMessage(() =>
      executeKecDirectoryPrune(
        createPlan(),
        Object.freeze({
          pruneSources: async () => {
            throw new Error(secret);
          },
        }),
      ),
    );
    expect(message).toBe(pruneErrors.pruneFailed);
    expect(message).not.toContain(secret);
  });

  it("is idempotent when a second complete plan observes no stale source", async () => {
    if (!task60ModulesExist()) return;
    const { executeKecDirectoryPrune, prepareKecDirectoryPrune } =
      await loadDirectoryPruningModule();
    const ledger = new Set([
      "manuals/active.pdf",
      "manuals/stale.pdf",
      "other/retained.pdf",
    ]);
    const pruneSources = vi.fn(
      async (expected: readonly string[], stale: readonly string[]) => {
        expect(new Set(expected)).toEqual(ledger);
        for (const sourcePath of stale) ledger.delete(sourcePath);
      },
    );
    const discovery = Object.freeze({
      directoryPath: "manuals",
      sources: Object.freeze(["manuals/active.pdf"]),
    });

    const firstPlan = prepareKecDirectoryPrune(discovery, [...ledger]);
    const first = await executeKecDirectoryPrune(firstPlan, { pruneSources });
    const secondPlan = prepareKecDirectoryPrune(discovery, [...ledger]);
    const second = await executeKecDirectoryPrune(secondPlan, { pruneSources });

    expect(first.deletedSourceCount).toBe(1);
    expect(second.deletedSourceCount).toBe(0);
    expect(second.sources).toEqual([]);
    expect(pruneSources).toHaveBeenCalledTimes(1);
    expect(ledger).toEqual(
      new Set(["manuals/active.pdf", "other/retained.pdf"]),
    );
  });
});

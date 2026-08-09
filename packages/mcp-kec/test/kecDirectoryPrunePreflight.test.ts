import { existsSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  captureErrorMessage,
  expectedPruneSourceId,
  loadDirectoryPruningModule,
  pruneBarrelPath,
  pruneErrors,
  sourceIdOrder,
  task60ModulesExist,
} from "./helpers/kecDirectoryPruneFixture.js";

describe("Task 60 persisted identity validation and prune planning", () => {
  it("is RED until the pure Task 60 prune planner exists", () => {
    expect(existsSync(pruneBarrelPath), "missing Task 60 prune planner").toBe(
      true,
    );
  });

  it("returns no stale sources when desired and indexed scope agree", async () => {
    if (!task60ModulesExist()) return;
    const { prepareKecDirectoryPrune } = await loadDirectoryPruningModule();
    const plan = prepareKecDirectoryPrune(
      { directoryPath: "manuals", sources: ["manuals/active.pdf"] },
      ["manuals/active.pdf", "other/retained.pdf"],
    );

    expect(plan).toMatchObject({
      desiredSourceCount: 1,
      indexedSourceCount: 1,
      staleSources: [],
    });
    expect(plan.expectedSourcePaths).toEqual([
      "manuals/active.pdf",
      "other/retained.pdf",
    ]);
  });

  it("computes one stale source while retaining active and out-of-scope sources", async () => {
    if (!task60ModulesExist()) return;
    const { prepareKecDirectoryPrune } = await loadDirectoryPruningModule();
    const stalePath = "manuals/old.pdf";
    const plan = prepareKecDirectoryPrune(
      { directoryPath: "manuals", sources: ["manuals/active.pdf"] },
      ["other/retained.pdf", stalePath, "manuals/active.pdf"],
    );

    expect(plan.indexedSourceCount).toBe(2);
    expect(plan.staleSources).toEqual([
      { sourcePath: stalePath, sourceId: expectedPruneSourceId(stalePath) },
    ]);
  });

  it("sorts multiple stale sources by full ASCII sourceId independent of snapshot order", async () => {
    if (!task60ModulesExist()) return;
    const { prepareKecDirectoryPrune } = await loadDirectoryPruningModule();
    const stale = ["manuals/zeta.pdf", "manuals/alpha.pdf", "manuals/한국.pdf"];
    const first = prepareKecDirectoryPrune(
      { directoryPath: "manuals", sources: ["manuals/current.pdf"] },
      ["manuals/current.pdf", ...stale],
    );
    const second = prepareKecDirectoryPrune(
      { directoryPath: "manuals", sources: ["manuals/current.pdf"] },
      [...stale].reverse().concat("manuals/current.pdf"),
    );

    expect(first.staleSources.map((source) => source.sourceId)).toEqual(
      sourceIdOrder(stale),
    );
    expect(second.staleSources).toEqual(first.staleSources);
  });

  it("uses exact direct-parent ownership for siblings, prefixes, and nested paths", async () => {
    if (!task60ModulesExist()) return;
    const { prepareKecDirectoryPrune } = await loadDirectoryPruningModule();
    const owned = "kec/a/stale.pdf";
    const plan = prepareKecDirectoryPrune(
      { directoryPath: "kec/a", sources: ["kec/a/active.pdf"] },
      [
        owned,
        "kec/a/active.pdf",
        "kec/abc/prefix.pdf",
        "kec/a/nested/deep.pdf",
        "kec/archive/sibling.pdf",
      ],
    );

    expect(plan.indexedSourceCount).toBe(2);
    expect(plan.staleSources).toEqual([
      { sourcePath: owned, sourceId: expectedPruneSourceId(owned) },
    ]);
  });

  it("computes indexedSourceCount from unique exact direct-child KEC identities only", async () => {
    expect(
      task60ModulesExist(),
      "missing Task 60 exact-scope source-count implementation",
    ).toBe(true);
    if (!task60ModulesExist()) return;
    const { executeKecDirectoryPrune, prepareKecDirectoryPrune } =
      await loadDirectoryPruningModule();
    const active = "kec/current/a.pdf";
    const stale = "kec/current/stale.pdf";
    const plan = prepareKecDirectoryPrune(
      { directoryPath: "kec/current", sources: [active] },
      [
        active,
        stale,
        "kec/current/nested/child.pdf",
        "kec/archive/archive.pdf",
        "kec/currentity/prefix.pdf",
      ],
    );

    expect(plan.desiredSourceCount).toBe(1);
    expect(plan.indexedSourceCount).toBe(2);
    expect(plan.staleSources).toEqual([
      { sourcePath: stale, sourceId: expectedPruneSourceId(stale) },
    ]);
    expect(plan.expectedSourcePaths).toEqual([
      active,
      stale,
      "kec/current/nested/child.pdf",
      "kec/archive/archive.pdf",
      "kec/currentity/prefix.pdf",
    ]);

    const pruneSources = vi.fn(async () => {});
    const result = await executeKecDirectoryPrune(plan, { pruneSources });
    expect(pruneSources).toHaveBeenCalledWith(plan.expectedSourcePaths, [
      stale,
    ]);
    expect(result).toEqual({
      schemaVersion: 1,
      status: "SUCCEEDED",
      desiredSourceCount: 1,
      indexedSourceCount: 2,
      deletedSourceCount: 1,
      sources: [{ sourceId: expectedPruneSourceId(stale), status: "DELETED" }],
    });
  });

  it("gives root dot ownership only to source paths with no slash", async () => {
    if (!task60ModulesExist()) return;
    const { prepareKecDirectoryPrune } = await loadDirectoryPruningModule();
    const plan = prepareKecDirectoryPrune(
      { directoryPath: ".", sources: ["active.pdf"] },
      ["active.pdf", "stale.pdf", "nested/retained.pdf"],
    );
    expect(plan.indexedSourceCount).toBe(2);
    expect(plan.desiredSourceCount).toBe(1);
    expect(plan.staleSources.map((source) => source.sourcePath)).toEqual([
      "stale.pdf",
    ]);
  });

  it.each(["manuals/legacy.PDF", "manuals/legacy.Pdf", "manuals/legacy.pDf"])(
    "accepts historical mixed-case managed identity %s and marks it stale",
    async (sourcePath) => {
      if (!task60ModulesExist()) return;
      const { prepareKecDirectoryPrune } = await loadDirectoryPruningModule();
      const plan = prepareKecDirectoryPrune(
        { directoryPath: "manuals", sources: ["manuals/current.pdf"] },
        ["manuals/current.pdf", sourcePath],
      );
      expect(plan.staleSources).toEqual([
        { sourcePath, sourceId: expectedPruneSourceId(sourcePath) },
      ]);
    },
  );

  it.each([
    "/absolute.pdf",
    "../escape.pdf",
    "manuals/../escape.pdf",
    "manuals\\bad.pdf",
    "manuals/./bad.pdf",
    "manuals//bad.pdf",
    "manuals/bad\0.pdf",
    "manuals/not-pdf.txt",
    "",
  ])(
    "rejects malformed complete-snapshot identity %j before planning",
    async (sourcePath) => {
      if (!task60ModulesExist()) return;
      const { prepareKecDirectoryPrune } = await loadDirectoryPruningModule();
      expect(
        captureErrorMessage(() =>
          prepareKecDirectoryPrune(
            { directoryPath: "manuals", sources: ["manuals/current.pdf"] },
            ["other/valid.pdf", sourcePath],
          ),
        ),
      ).toBe(pruneErrors.invalidIndexState);
    },
  );

  it.each(["manuals/.pdf", "manuals/.PDF", ".pdf", ".PDF"])(
    "rejects basename-less persisted PDF identity %j",
    async (sourcePath) => {
      expect(
        task60ModulesExist(),
        "missing Task 60 basename-less persisted identity validation",
      ).toBe(true);
      if (!task60ModulesExist()) return;
      const { prepareKecDirectoryPrune } = await loadDirectoryPruningModule();
      expect(
        captureErrorMessage(() =>
          prepareKecDirectoryPrune(
            { directoryPath: "manuals", sources: ["manuals/current.pdf"] },
            ["manuals/current.pdf", sourcePath],
          ),
        ),
      ).toBe(pruneErrors.invalidIndexState);
    },
  );

  it.each([
    "/outside/absolute.pdf",
    "../outside.pdf",
    "other\\outside.pdf",
    "other//empty-segment.pdf",
    "other/./dot-segment.pdf",
  ])(
    "validates out-of-scope malformed identity %j before ownership filtering",
    async (malformedSourcePath) => {
      expect(
        task60ModulesExist(),
        "missing Task 60 complete-snapshot validation before scope filtering",
      ).toBe(true);
      if (!task60ModulesExist()) return;
      const { prepareKecDirectoryPrune } = await loadDirectoryPruningModule();
      const secret = `secret:${malformedSourcePath}`;
      const message = captureErrorMessage(() =>
        prepareKecDirectoryPrune(
          {
            directoryPath: "kec/current",
            sources: ["kec/current/a.pdf"],
          },
          ["kec/current/a.pdf", "kec/current/stale.pdf", malformedSourcePath],
        ),
      );

      expect(message).toBe(pruneErrors.invalidIndexState);
      expect(message).not.toContain(secret);
      expect(message).not.toContain(malformedSourcePath);
    },
  );

  it("rejects duplicate injected source identity instead of silently repairing it", async () => {
    if (!task60ModulesExist()) return;
    const { prepareKecDirectoryPrune } = await loadDirectoryPruningModule();
    expect(
      captureErrorMessage(() =>
        prepareKecDirectoryPrune(
          { directoryPath: "manuals", sources: ["manuals/current.pdf"] },
          ["manuals/stale.pdf", "manuals/stale.pdf"],
        ),
      ),
    ).toBe(pruneErrors.invalidIndexState);
  });

  it("derives the exact Task 56/58-compatible UTF-8 sourceId", async () => {
    if (!task60ModulesExist()) return;
    const { prepareKecDirectoryPrune } = await loadDirectoryPruningModule();
    const sourcePath = "manuals/한국전기설비규정.PDF";
    const plan = prepareKecDirectoryPrune(
      { directoryPath: "manuals", sources: ["manuals/current.pdf"] },
      [sourcePath],
    );
    expect(plan.staleSources[0]?.sourceId).toBe(
      expectedPruneSourceId(sourcePath),
    );
    expect(plan.staleSources[0]?.sourceId).toMatch(/^kecsrc_[0-9a-f]{64}$/u);
  });
});

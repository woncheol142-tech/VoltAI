import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type {
  KecRequirementExtraction,
  KecRequirementExtractionBinding,
  KecRequirementExtractionSnapshot,
} from "../src/knowledge/requirementExtraction.js";
import {
  cleanupTempSnapshotDatabases,
  createTempSnapshotDatabase,
  DatabaseSync,
  semanticRows,
  task91Binding,
  task91BlobHash,
  task91Requirement,
  task91Snapshot,
} from "./fixtures/requirementSnapshotContracts.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const storeExists = existsSync(
  join(packageRoot, "src", "requirementSnapshot", "index.ts"),
);

type Store = {
  storeSnapshot(snapshot: KecRequirementExtractionSnapshot): void;
  loadSnapshot(
    binding: KecRequirementExtractionBinding,
  ): KecRequirementExtractionSnapshot | null;
  close(): void;
};

async function StoreConstructor(): Promise<new (dbPath: string) => Store> {
  const module = (await import(
    /* @vite-ignore */ fileURLToPath(
      new URL("../src/requirementSnapshot/index.ts", import.meta.url),
    )
  )) as { readonly KecRequirementSnapshotStore: new (dbPath: string) => Store };
  return module.KecRequirementSnapshotStore;
}

function captureCategory(action: () => unknown): string | undefined {
  try {
    action();
    return undefined;
  } catch (error) {
    return typeof error === "object" && error !== null && "category" in error
      ? String(error.category)
      : undefined;
  }
}

function errorCategory(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "category" in error
    ? String(error.category)
    : undefined;
}

function withRequirements(
  snapshot: KecRequirementExtractionSnapshot,
  requirements: readonly KecRequirementExtraction[],
): KecRequirementExtractionSnapshot {
  return { binding: snapshot.binding, requirements };
}

describe.runIf(storeExists)("Task91 complete extraction snapshot store", () => {
  afterEach(cleanupTempSnapshotDatabases);

  it("distinguishes a missing snapshot from a durably persisted empty one", async () => {
    const binding = task91Binding();
    const empty = { binding, requirements: [] };
    const { dbPath } = createTempSnapshotDatabase();
    const Constructor = await StoreConstructor();
    const before = new Constructor(dbPath);
    expect(before.loadSnapshot(binding)).toBeNull();
    before.storeSnapshot(empty);
    before.close();

    const reopened = new Constructor(dbPath);
    expect(reopened.loadSnapshot(binding)).toEqual(empty);
    expect(reopened.loadSnapshot(binding)).not.toBeNull();
    reopened.close();
  });

  it("atomically stores one ordered population and treats exact replay as a no-op", async () => {
    const snapshot = task91Snapshot();
    const { dbPath } = createTempSnapshotDatabase();
    const Constructor = await StoreConstructor();
    const store = new Constructor(dbPath);
    store.storeSnapshot(snapshot);
    const once = semanticRows(dbPath);
    store.storeSnapshot(snapshot);
    expect(semanticRows(dbPath)).toEqual(once);
    expect(store.loadSnapshot(snapshot.binding)).toEqual(snapshot);
    store.close();

    expect(once.snapshots).toHaveLength(1);
    expect(once.members).toHaveLength(snapshot.requirements.length);
    expect(once.members.map((row) => row.population_index)).toEqual([0, 1]);
    expect(once.members.map((row) => row.requirement_id)).toEqual([
      "z-extraction-first",
      "a-extraction-second",
    ]);
  });

  it("never leaves a partial new snapshot when a later member is invalid", async () => {
    const snapshot = task91Snapshot();
    const invalid = withRequirements(snapshot, [
      snapshot.requirements[0]!,
      task91Requirement(snapshot.binding, {
        id: "invalid-second-member",
        locators: [] as never,
      }),
    ]);
    const { dbPath } = createTempSnapshotDatabase();
    const Constructor = await StoreConstructor();
    const store = new Constructor(dbPath);
    expect(captureCategory(() => store.storeSnapshot(invalid))).toBe(
      "locator-encode",
    );
    expect(semanticRows(dbPath)).toEqual({ snapshots: [], members: [] });
    store.close();
  });

  it.each([
    [
      "subset",
      (snapshot: KecRequirementExtractionSnapshot) =>
        withRequirements(snapshot, snapshot.requirements.slice(0, 1)),
    ],
    [
      "superset",
      (snapshot: KecRequirementExtractionSnapshot) =>
        withRequirements(snapshot, [
          ...snapshot.requirements,
          task91Requirement(snapshot.binding, {
            id: "m-extra",
            statement: "추가 요구사항은 시설하여야 한다",
          }),
        ]),
    ],
    [
      "reordered population",
      (snapshot: KecRequirementExtractionSnapshot) =>
        withRequirements(snapshot, [...snapshot.requirements].reverse()),
    ],
    [
      "same id with different statement",
      (snapshot: KecRequirementExtractionSnapshot) =>
        withRequirements(snapshot, [
          task91Requirement(snapshot.binding, {
            id: snapshot.requirements[0]!.requirement.id,
            statement: "변경된 문장이어야 한다",
            locators: snapshot.requirements[0]!.provenance.locators,
          }),
          snapshot.requirements[1]!,
        ]),
    ],
    [
      "same id with different locators",
      (snapshot: KecRequirementExtractionSnapshot) =>
        withRequirements(snapshot, [
          task91Requirement(snapshot.binding, {
            id: snapshot.requirements[0]!.requirement.id,
            statement: snapshot.requirements[0]!.requirement.statement,
            locators: [
              { pageNumber: 99, startItemIndex: 1, endItemIndexExclusive: 2 },
            ],
          }),
          snapshot.requirements[1]!,
        ]),
    ],
  ])(
    "rejects %s as a complete-set conflict without mutation",
    async (_name, attack) => {
      const snapshot = task91Snapshot();
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      const store = new Constructor(dbPath);
      store.storeSnapshot(snapshot);
      const before = semanticRows(dbPath);

      expect(captureCategory(() => store.storeSnapshot(attack(snapshot)))).toBe(
        "snapshot-conflict",
      );
      expect(semanticRows(dbPath)).toEqual(before);
      store.close();
    },
  );

  it("allows immutable historical snapshots to coexist without latest/current semantics", async () => {
    const first = task91Snapshot();
    const differentBlob = task91Snapshot(
      task91Binding({ blobHash: task91BlobHash("different-blob") }),
    );
    const differentContract = task91Snapshot(
      task91Binding({
        extractionContract: "kec:future-contract:v2" as never,
      }),
    );
    const { dbPath } = createTempSnapshotDatabase();
    const Constructor = await StoreConstructor();
    const store = new Constructor(dbPath);
    store.storeSnapshot(first);
    store.storeSnapshot(differentBlob);
    store.storeSnapshot(differentContract);

    expect(store.loadSnapshot(first.binding)).toEqual(first);
    expect(store.loadSnapshot(differentBlob.binding)).toEqual(differentBlob);
    expect(store.loadSnapshot(differentContract.binding)).toEqual(
      differentContract,
    );
    expect(semanticRows(dbPath).snapshots).toHaveLength(3);
    store.close();
  });

  it.each([
    [
      "population gap",
      "UPDATE kec_requirement_snapshot_members SET population_index = 3 WHERE population_index = 1",
    ],
    [
      "population does not start at zero",
      "UPDATE kec_requirement_snapshot_members SET population_index = population_index + 2",
    ],
    [
      "wrong blob algorithm",
      "UPDATE kec_requirement_snapshots SET blob_algorithm = 'sha-512'",
    ],
    [
      "wrong stored locator space",
      "UPDATE kec_requirement_snapshots SET locator_space = 'unknown:space:v1'",
    ],
  ])("fails closed for %s", async (_name, corruptionSql) => {
    const snapshot = task91Snapshot();
    const { dbPath } = createTempSnapshotDatabase();
    const Constructor = await StoreConstructor();
    const writer = new Constructor(dbPath);
    writer.storeSnapshot(snapshot);
    writer.close();
    const database = new DatabaseSync(dbPath);
    database.exec(corruptionSql);
    database.close();

    let reader: Store | undefined;
    let category: string | undefined;
    try {
      reader = new Constructor(dbPath);
      category = captureCategory(() => reader!.loadSnapshot(snapshot.binding));
    } catch (error) {
      category = errorCategory(error);
    } finally {
      reader?.close();
    }
    expect(category).toBe("member-corruption");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type {
  KecRequirementExtractionBinding,
  KecRequirementExtractionSnapshot,
} from "../src/knowledge/requirementExtraction.js";
import type {
  KecCapturedRequirementSnapshot,
  KecSourceCaptureContractId,
  KecSourceCaptureObservation,
  KecSourceCaptureSnapshot,
} from "./fixtures/sourceCaptureContracts.js";
import {
  capturedEmptySnapshot,
  capturedSingleFragmentSnapshot,
  captureSpan,
  TASK93_CAPTURE_CONTRACT_ID,
} from "./fixtures/sourceCaptureContracts.js";
import {
  cleanupTempSnapshotDatabases,
  createTempSnapshotDatabase,
  DatabaseSync,
  initializeExactTask91V1Database,
  seedTask91V1Snapshot,
  semanticRows,
  task91Binding,
  task91BlobHash,
  task91Requirement,
  task91Snapshot,
} from "./fixtures/requirementSnapshotContracts.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const storePath = join(packageRoot, "src", "requirementSnapshot", "store.ts");
const storeSource = readFileSync(storePath, "utf8");
const combinedStoreApiExists =
  /\bstoreCapturedSnapshot\s*\(/u.test(storeSource) &&
  /\bloadSnapshotWithCapture\s*\(/u.test(storeSource);

type PairedLoadResult =
  | { readonly status: "not-found" }
  | {
      readonly status: "capture-absent";
      readonly requirementSnapshot: KecRequirementExtractionSnapshot;
    }
  | {
      readonly status: "captured";
      readonly requirementSnapshot: KecRequirementExtractionSnapshot;
      readonly captureSnapshot: KecSourceCaptureSnapshot;
    };

type Store = {
  storeSnapshot(snapshot: KecRequirementExtractionSnapshot): void;
  loadSnapshot(
    binding: KecRequirementExtractionBinding,
  ): KecRequirementExtractionSnapshot | null;
  storeCapturedSnapshot(snapshot: KecCapturedRequirementSnapshot): void;
  loadSnapshotWithCapture(
    binding: KecRequirementExtractionBinding,
    captureContract: KecSourceCaptureContractId,
  ): PairedLoadResult;
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

async function expectStoreError(
  action: () => unknown,
  expectedCategory: string,
): Promise<void> {
  const module = (await import(
    /* @vite-ignore */ fileURLToPath(
      new URL("../src/requirementSnapshot/index.ts", import.meta.url),
    )
  )) as {
    readonly KecRequirementSnapshotStoreError: new (
      category: string,
    ) => Error & { readonly category: string };
  };
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(module.KecRequirementSnapshotStoreError);
  expect(thrown).toMatchObject({ category: expectedCategory });
}

function categoryOf(action: () => unknown): string | undefined {
  try {
    action();
    return undefined;
  } catch (error) {
    return typeof error === "object" && error !== null && "category" in error
      ? String(error.category)
      : undefined;
  }
}

function task93RequirementSnapshot(): KecRequirementExtractionSnapshot {
  const binding = task91Binding();
  return {
    binding,
    requirements: [
      task91Requirement(binding, {
        id: "task93-first",
        statement: "첫 번째 설비는 시설하여야 한다",
        locators: [
          { pageNumber: 1, startItemIndex: 2, endItemIndexExclusive: 4 },
        ],
      }),
      task91Requirement(binding, {
        id: "task93-second",
        statement: "두 번째 설비는 점검하여야 한다",
        locators: [
          { pageNumber: 2, startItemIndex: 1, endItemIndexExclusive: 2 },
        ],
      }),
    ],
  };
}

function capturedFixture(): KecCapturedRequirementSnapshot {
  return capturedSingleFragmentSnapshot(task93RequirementSnapshot());
}

function withObservations(
  captured: KecCapturedRequirementSnapshot,
  observations: readonly KecSourceCaptureObservation[],
): KecCapturedRequirementSnapshot {
  return {
    requirementSnapshot: captured.requirementSnapshot,
    captureSnapshot: { ...captured.captureSnapshot, observations },
  };
}

function captureRows(dbPath: string): {
  readonly headers: readonly Record<string, unknown>[];
  readonly observations: readonly Record<string, unknown>[];
} {
  const database = new DatabaseSync(dbPath);
  try {
    return {
      headers: database
        .prepare(
          `SELECT * FROM kec_requirement_snapshot_captures
           ORDER BY snapshot_id, capture_contract`,
        )
        .all() as Record<string, unknown>[],
      observations: database
        .prepare(
          `SELECT * FROM kec_requirement_snapshot_capture_observations
           ORDER BY snapshot_id, capture_contract, observation_index`,
        )
        .all() as Record<string, unknown>[],
    };
  } finally {
    database.close();
  }
}

afterEach(cleanupTempSnapshotDatabases);

describe("Task93 combined persistence RED gate", () => {
  it("fails explicitly until combined store and paired-load APIs exist", () => {
    expect(
      combinedStoreApiExists,
      "Task93 requires storeCapturedSnapshot and loadSnapshotWithCapture",
    ).toBe(true);
  });
});

describe.runIf(combinedStoreApiExists)(
  "Task93 capture-aware Requirement snapshot store",
  () => {
    it("jointly stores a new Requirement snapshot, header, and observations", async () => {
      const captured = capturedFixture();
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      const writer = new Constructor(dbPath);
      writer.storeCapturedSnapshot(captured);
      writer.close();

      const reader = new Constructor(dbPath);
      expect(
        reader.loadSnapshotWithCapture(
          captured.requirementSnapshot.binding,
          TASK93_CAPTURE_CONTRACT_ID,
        ),
      ).toEqual({
        status: "captured",
        requirementSnapshot: captured.requirementSnapshot,
        captureSnapshot: captured.captureSnapshot,
      });
      reader.close();
      expect(semanticRows(dbPath).snapshots).toHaveLength(1);
      expect(captureRows(dbPath).headers).toHaveLength(1);
      expect(captureRows(dbPath).observations).toHaveLength(2);
    });

    it("uses one transaction and rolls back all rows after a late observation failure", async () => {
      const captured = capturedFixture();
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      const store = new Constructor(dbPath);
      const attacker = new DatabaseSync(dbPath);
      attacker.exec(`
        CREATE TRIGGER task93_fail_observation
        BEFORE INSERT ON kec_requirement_snapshot_capture_observations
        BEGIN SELECT RAISE(ABORT, 'task93 late capture failure'); END;
      `);
      attacker.close();

      expect(() => store.storeCapturedSnapshot(captured)).toThrow();
      expect(semanticRows(dbPath)).toEqual({ snapshots: [], members: [] });
      expect(captureRows(dbPath)).toEqual({ headers: [], observations: [] });
      store.close();

      const cleanup = new DatabaseSync(dbPath);
      cleanup.exec("DROP TRIGGER task93_fail_observation");
      cleanup.close();
    });

    it("enriches an exact existing Requirement population without updating it", async () => {
      const captured = capturedFixture();
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      const store = new Constructor(dbPath);
      store.storeSnapshot(captured.requirementSnapshot);
      const requirementBefore = semanticRows(dbPath);
      expect(
        store.loadSnapshotWithCapture(
          captured.requirementSnapshot.binding,
          TASK93_CAPTURE_CONTRACT_ID,
        ),
      ).toEqual({
        status: "capture-absent",
        requirementSnapshot: captured.requirementSnapshot,
      });

      store.storeCapturedSnapshot(captured);
      expect(semanticRows(dbPath)).toEqual(requirementBefore);
      expect(captureRows(dbPath).headers).toHaveLength(1);
      store.close();
    });

    it("distinguishes not-found, capture-absent, and captured-empty", async () => {
      const binding = task91Binding();
      const empty = capturedEmptySnapshot(binding);
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      const store = new Constructor(dbPath);
      expect(
        store.loadSnapshotWithCapture(binding, TASK93_CAPTURE_CONTRACT_ID),
      ).toEqual({ status: "not-found" });

      store.storeSnapshot(empty.requirementSnapshot);
      expect(
        store.loadSnapshotWithCapture(binding, TASK93_CAPTURE_CONTRACT_ID),
      ).toEqual({
        status: "capture-absent",
        requirementSnapshot: empty.requirementSnapshot,
      });

      store.storeCapturedSnapshot(empty);
      expect(
        store.loadSnapshotWithCapture(binding, TASK93_CAPTURE_CONTRACT_ID),
      ).toEqual({
        status: "captured",
        requirementSnapshot: empty.requirementSnapshot,
        captureSnapshot: empty.captureSnapshot,
      });
      expect(captureRows(dbPath)).toMatchObject({
        headers: [expect.any(Object)],
        observations: [],
      });
      store.close();
    });

    it("rejects empty capture for a non-empty Requirement population without partial writes", async () => {
      const base = capturedFixture();
      const invalid = withObservations(base, []);
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      const store = new Constructor(dbPath);
      await expectStoreError(
        () => store.storeCapturedSnapshot(invalid),
        "capture-invalid",
      );
      expect(semanticRows(dbPath)).toEqual({ snapshots: [], members: [] });
      expect(captureRows(dbPath)).toEqual({ headers: [], observations: [] });
      store.close();
    });

    it("rejects a foreign assembly Requirement ID before writing", async () => {
      const base = capturedFixture();
      const first = base.captureSnapshot.observations[0];
      if (!first || first.kind !== "requirement-assembly") {
        throw new Error("Task93 fixture requires a first assembly");
      }
      const invalid = withObservations(base, [
        {
          ...first,
          requirementId: "foreign-requirement" as typeof first.requirementId,
        },
        ...base.captureSnapshot.observations.slice(1),
      ]);
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      const store = new Constructor(dbPath);
      expect(categoryOf(() => store.storeCapturedSnapshot(invalid))).toBe(
        "capture-invalid",
      );
      expect(semanticRows(dbPath)).toEqual({ snapshots: [], members: [] });
      store.close();
    });

    it("rejects mismatched Requirement and capture bindings before writing", async () => {
      const base = capturedFixture();
      const invalid: KecCapturedRequirementSnapshot = {
        ...base,
        captureSnapshot: {
          ...base.captureSnapshot,
          binding: task91Binding({
            blobHash: task91BlobHash("task93-mismatched-source"),
          }),
        },
      };
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      const store = new Constructor(dbPath);
      expect(categoryOf(() => store.storeCapturedSnapshot(invalid))).toBe(
        "binding-mismatch",
      );
      expect(semanticRows(dbPath)).toEqual({ snapshots: [], members: [] });
      expect(captureRows(dbPath)).toEqual({ headers: [], observations: [] });
      store.close();
    });

    it("rejects enrichment when the stored Requirement population differs", async () => {
      const captured = capturedFixture();
      const conflicting: KecRequirementExtractionSnapshot = {
        ...captured.requirementSnapshot,
        requirements: captured.requirementSnapshot.requirements.map(
          (member, index) =>
            index === 0
              ? {
                  ...member,
                  requirement: {
                    ...member.requirement,
                    statement: "충돌하는 기존 요구사항",
                  },
                }
              : member,
        ),
      };
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      const store = new Constructor(dbPath);
      store.storeSnapshot(conflicting);
      const before = semanticRows(dbPath);
      expect(categoryOf(() => store.storeCapturedSnapshot(captured))).toBe(
        "snapshot-conflict",
      );
      expect(semanticRows(dbPath)).toEqual(before);
      expect(captureRows(dbPath)).toEqual({ headers: [], observations: [] });
      store.close();
    });

    it.each([
      [
        "subset",
        (base: KecCapturedRequirementSnapshot) =>
          withObservations(base, base.captureSnapshot.observations.slice(0, 1)),
      ],
      [
        "superset",
        (base: KecCapturedRequirementSnapshot) =>
          withObservations(base, [
            ...base.captureSnapshot.observations,
            {
              kind: "column-gap-region-excluded" as const,
              span: captureSpan(3, 0, 2),
              observedText: "추가 관찰",
            },
          ]),
      ],
      [
        "reorder",
        (base: KecCapturedRequirementSnapshot) =>
          withObservations(
            base,
            [...base.captureSnapshot.observations].reverse(),
          ),
      ],
      [
        "changed kind",
        (base: KecCapturedRequirementSnapshot) =>
          withObservations(base, [
            {
              kind: "column-gap-region-excluded" as const,
              span: captureSpan(1, 2, 4),
              observedText: "첫 번째 설비는 시설하여야 한다",
            },
            ...base.captureSnapshot.observations.slice(1),
          ]),
      ],
      [
        "changed text",
        (base: KecCapturedRequirementSnapshot) => {
          const first = base.captureSnapshot.observations[0]!;
          if (first.kind !== "requirement-assembly") return base;
          return withObservations(base, [
            {
              ...first,
              fragments: [
                { ...first.fragments[0]!, observedText: "변경된 관찰" },
              ],
            },
            ...base.captureSnapshot.observations.slice(1),
          ]);
        },
      ],
      [
        "changed detector set",
        (base: KecCapturedRequirementSnapshot) => {
          const first = base.captureSnapshot.observations[0]!;
          if (first.kind !== "requirement-assembly") return base;
          return withObservations(base, [
            {
              ...first,
              fragments: [
                {
                  ...first.fragments[0]!,
                  detectors: [
                    "normative-sentence-ending" as const,
                    "short-heading-adjacent" as const,
                  ],
                },
              ],
            },
            ...base.captureSnapshot.observations.slice(1),
          ]);
        },
      ],
      [
        "changed anchors",
        (base: KecCapturedRequirementSnapshot) => {
          const first = base.captureSnapshot.observations[0]!;
          if (first.kind !== "requirement-assembly") return base;
          return withObservations(base, [
            {
              ...first,
              fragments: [
                { ...first.fragments[0]!, span: captureSpan(1, 20, 21) },
              ],
            },
            ...base.captureSnapshot.observations.slice(1),
          ]);
        },
      ],
      [
        "changed relational payload",
        (base: KecCapturedRequirementSnapshot) => {
          const first = base.captureSnapshot.observations[0]!;
          if (first.kind !== "requirement-assembly") return base;
          return withObservations(base, [
            {
              ...first,
              contextSearchTermination: "preceding-normative-paragraph",
            },
            ...base.captureSnapshot.observations.slice(1),
          ]);
        },
      ],
    ])(
      "rejects capture replay %s as capture-conflict",
      async (_name, attack) => {
        const base = capturedFixture();
        const { dbPath } = createTempSnapshotDatabase();
        const Constructor = await StoreConstructor();
        const store = new Constructor(dbPath);
        store.storeCapturedSnapshot(base);
        const before = {
          requirement: semanticRows(dbPath),
          capture: captureRows(dbPath),
        };
        await expectStoreError(
          () => store.storeCapturedSnapshot(attack(base)),
          "capture-conflict",
        );
        expect({
          requirement: semanticRows(dbPath),
          capture: captureRows(dbPath),
        }).toEqual(before);
        store.close();
      },
    );

    it("treats exact capture replay as a no-op", async () => {
      const base = capturedFixture();
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      const store = new Constructor(dbPath);
      store.storeCapturedSnapshot(base);
      const before = captureRows(dbPath);
      expect(() => store.storeCapturedSnapshot(base)).not.toThrow();
      expect(captureRows(dbPath)).toEqual(before);
      store.close();
    });

    it("loads v1 Requirement rows as capture-absent and missing rows as not-found", async () => {
      const snapshot = task91Snapshot();
      const missingBinding = task91Binding({
        extractionContract: "kec:missing-contract:v1" as never,
      });
      const { dbPath } = createTempSnapshotDatabase();
      initializeExactTask91V1Database(dbPath);
      seedTask91V1Snapshot(dbPath, snapshot);
      const Constructor = await StoreConstructor();
      const store = new Constructor(dbPath);
      expect(
        store.loadSnapshotWithCapture(
          missingBinding,
          TASK93_CAPTURE_CONTRACT_ID,
        ),
      ).toEqual({ status: "not-found" });
      expect(
        store.loadSnapshotWithCapture(
          snapshot.binding,
          TASK93_CAPTURE_CONTRACT_ID,
        ),
      ).toEqual({ status: "capture-absent", requirementSnapshot: snapshot });
      store.close();
    });

    it("rejects capture-aware writes on v1 without a partial Requirement write", async () => {
      const captured = capturedFixture();
      const { dbPath } = createTempSnapshotDatabase();
      initializeExactTask91V1Database(dbPath);
      const Constructor = await StoreConstructor();
      const store = new Constructor(dbPath);
      await expectStoreError(
        () => store.storeCapturedSnapshot(captured),
        "capture-unsupported-schema",
      );
      expect(semanticRows(dbPath)).toEqual({ snapshots: [], members: [] });
      const database = new DatabaseSync(dbPath);
      expect(database.prepare("PRAGMA user_version").get()).toEqual({
        user_version: 1,
      });
      database.close();
      store.close();
    });

    it("fails paired load for persisted coverage and foreign-ID corruption", async () => {
      const captured = capturedFixture();
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      const writer = new Constructor(dbPath);
      writer.storeCapturedSnapshot(captured);
      writer.close();
      const database = new DatabaseSync(dbPath);
      const row = database
        .prepare(
          `SELECT payload_json
           FROM kec_requirement_snapshot_capture_observations
           WHERE observation_index = 0`,
        )
        .get() as { readonly payload_json: string };
      database
        .prepare(
          `UPDATE kec_requirement_snapshot_capture_observations
           SET payload_json = ? WHERE observation_index = 0`,
        )
        .run(row.payload_json.replace("task93-first", "foreign-id"));
      database.close();

      const reader = new Constructor(dbPath);
      await expectStoreError(
        () =>
          reader.loadSnapshotWithCapture(
            captured.requirementSnapshot.binding,
            TASK93_CAPTURE_CONTRACT_ID,
          ),
        "capture-corruption",
      );
      reader.close();
    });

    it("fails paired load when a non-empty population loses an assembly row", async () => {
      const captured = capturedFixture();
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      const writer = new Constructor(dbPath);
      writer.storeCapturedSnapshot(captured);
      writer.close();
      const database = new DatabaseSync(dbPath);
      database.exec(
        `DELETE FROM kec_requirement_snapshot_capture_observations
         WHERE observation_index = 1`,
      );
      database.close();
      const reader = new Constructor(dbPath);
      expect(
        categoryOf(() =>
          reader.loadSnapshotWithCapture(
            captured.requirementSnapshot.binding,
            TASK93_CAPTURE_CONTRACT_ID,
          ),
        ),
      ).toBe("capture-corruption");
      reader.close();
    });

    it.each([
      [
        "capture header without Requirement snapshot",
        `INSERT INTO kec_requirement_snapshot_captures
           (snapshot_id, capture_contract)
         VALUES (999, '${TASK93_CAPTURE_CONTRACT_ID}')`,
      ],
      [
        "capture observation without header",
        `INSERT INTO kec_requirement_snapshot_capture_observations
           (snapshot_id, capture_contract, observation_index, kind, payload_json)
         VALUES (
           999, '${TASK93_CAPTURE_CONTRACT_ID}', 0,
           'column-gap-region-excluded',
           '{"kind":"column-gap-region-excluded","span":{"pageNumber":1,"startItemIndex":0,"endItemIndexExclusive":1},"observedText":"x"}'
         )`,
      ],
    ])("runs a bounded open audit for %s", async (_name, sql) => {
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      new Constructor(dbPath).close();
      const database = new DatabaseSync(dbPath);
      database.exec(sql);
      database.close();
      expect(categoryOf(() => new Constructor(dbPath))).toBe(
        "capture-corruption",
      );
    });

    it("runs a bounded open audit for unknown capture kind", async () => {
      const empty = capturedEmptySnapshot(task91Binding());
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      const writer = new Constructor(dbPath);
      writer.storeCapturedSnapshot(empty);
      writer.close();
      const database = new DatabaseSync(dbPath);
      const header = database
        .prepare(
          "SELECT snapshot_id, capture_contract FROM kec_requirement_snapshot_captures",
        )
        .get() as {
        readonly snapshot_id: number;
        readonly capture_contract: string;
      };
      database
        .prepare(
          `INSERT INTO kec_requirement_snapshot_capture_observations
             (snapshot_id, capture_contract, observation_index, kind, payload_json)
           VALUES (?, ?, 0, 'unknown-kind', '{}')`,
        )
        .run(header.snapshot_id, header.capture_contract);
      database.close();
      expect(categoryOf(() => new Constructor(dbPath))).toBe(
        "capture-corruption",
      );
    });

    it("requires the persisted kind column to match payload kind", async () => {
      const captured = capturedFixture();
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      const writer = new Constructor(dbPath);
      writer.storeCapturedSnapshot(captured);
      writer.close();
      const database = new DatabaseSync(dbPath);
      database.exec(
        `UPDATE kec_requirement_snapshot_capture_observations
         SET kind = 'suppressed-assembly' WHERE observation_index = 0`,
      );
      database.close();
      const reader = new Constructor(dbPath);
      expect(
        categoryOf(() =>
          reader.loadSnapshotWithCapture(
            captured.requirementSnapshot.binding,
            TASK93_CAPTURE_CONTRACT_ID,
          ),
        ),
      ).toBe("capture-corruption");
      reader.close();
    });

    it("defers canonical payload parsing from open to paired load", async () => {
      const captured = capturedFixture();
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      const writer = new Constructor(dbPath);
      writer.storeCapturedSnapshot(captured);
      writer.close();
      const database = new DatabaseSync(dbPath);
      database.exec(
        `UPDATE kec_requirement_snapshot_capture_observations
         SET payload_json = '{}' WHERE observation_index = 0`,
      );
      database.close();

      const reader = new Constructor(dbPath);
      expect(
        categoryOf(() =>
          reader.loadSnapshotWithCapture(
            captured.requirementSnapshot.binding,
            TASK93_CAPTURE_CONTRACT_ID,
          ),
        ),
      ).toBe("capture-corruption");
      reader.close();
    });
  },
);

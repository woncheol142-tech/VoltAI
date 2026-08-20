import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type {
  KecRequirementExtractionBinding,
  KecRequirementExtractionSnapshot,
} from "../src/knowledge/requirementExtraction.js";
import {
  canonicalLocators,
  cleanupTempSnapshotDatabases,
  createTempSnapshotDatabase,
  DatabaseSync,
  task91Binding,
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

describe.runIf(storeExists)("Task91 canonical KEC locator codec", () => {
  afterEach(cleanupTempSnapshotDatabases);

  it("stores compact tuple JSON and preserves locator order byte-for-byte", async () => {
    const snapshot = task91Snapshot();
    const { dbPath } = createTempSnapshotDatabase();
    const Constructor = await StoreConstructor();
    const store = new Constructor(dbPath);
    store.storeSnapshot(snapshot);
    store.close();

    const database = new DatabaseSync(dbPath);
    const rows = database
      .prepare(
        `SELECT population_index, locators_json
         FROM kec_requirement_snapshot_members
         ORDER BY population_index ASC`,
      )
      .all() as Array<{
      readonly population_index: number;
      readonly locators_json: string;
    }>;
    database.close();

    expect(rows).toEqual(
      snapshot.requirements.map((member, population_index) => ({
        population_index,
        locators_json: canonicalLocators(member.provenance.locators),
      })),
    );
    expect(JSON.stringify(JSON.parse(rows[0]!.locators_json))).toBe(
      rows[0]!.locators_json,
    );
  });

  it.each([
    ["empty locator list", []],
    [
      "negative value",
      [{ pageNumber: -1, startItemIndex: 0, endItemIndexExclusive: 1 }],
    ],
    [
      "negative zero",
      [{ pageNumber: -0, startItemIndex: 0, endItemIndexExclusive: 1 }],
    ],
    [
      "non-integer",
      [{ pageNumber: 1.5, startItemIndex: 0, endItemIndexExclusive: 1 }],
    ],
    [
      "unsafe integer",
      [
        {
          pageNumber: Number.MAX_SAFE_INTEGER + 1,
          startItemIndex: 0,
          endItemIndexExclusive: 1,
        },
      ],
    ],
  ])("rejects %s during encoding", async (_name, locators) => {
    const binding = task91Binding();
    const snapshot = {
      binding,
      requirements: [
        task91Requirement(binding, {
          locators: locators as never,
        }),
      ],
    };
    const { dbPath } = createTempSnapshotDatabase();
    const Constructor = await StoreConstructor();
    const store = new Constructor(dbPath);
    expect(captureCategory(() => store.storeSnapshot(snapshot))).toBe(
      "locator-encode",
    );
    store.close();
  });

  it.each([
    ["invalid JSON", "{"],
    ["empty array", "[]"],
    [
      "object form",
      '[{"pageNumber":1,"startItemIndex":0,"endItemIndexExclusive":1}]',
    ],
    ["whitespace padded", " [[1,0,1]]"],
    ["wrong tuple arity", "[[1,0]]"],
    ["negative value", "[[-1,0,1]]"],
    ["negative zero", "[[-0,0,1]]"],
    ["non-integer", "[[1.5,0,1]]"],
    ["unsafe integer", `[[${Number.MAX_SAFE_INTEGER + 1},0,1]]`],
  ])("fails closed for persisted %s", async (_name, storedText) => {
    const snapshot = task91Snapshot();
    const { dbPath } = createTempSnapshotDatabase();
    const Constructor = await StoreConstructor();
    const writer = new Constructor(dbPath);
    writer.storeSnapshot(snapshot);
    writer.close();
    const database = new DatabaseSync(dbPath);
    database
      .prepare(
        `UPDATE kec_requirement_snapshot_members
         SET locators_json = ? WHERE population_index = 0`,
      )
      .run(storedText);
    database.close();

    const reader = new Constructor(dbPath);
    expect(captureCategory(() => reader.loadSnapshot(snapshot.binding))).toBe(
      "locator-decode",
    );
    reader.close();
  });
});

import { createHash } from "node:crypto";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type {
  KecRequirementExtractionBinding,
  KecRequirementExtractionSnapshot,
} from "../src/knowledge/requirementExtraction.js";
import {
  createRequirementPdfFixture,
  deterministicKoreanPdfBytes,
  explicitSourceRevision,
  type RequirementPdfFixture,
} from "./fixtures/requirementExtractionContracts.js";
import {
  cleanupTempSnapshotDatabases,
  createTempSnapshotDatabase,
} from "./fixtures/requirementSnapshotContracts.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const producerPath = join(
  packageRoot,
  "src",
  "knowledge",
  "requirementExtraction.ts",
);
const storePath = join(packageRoot, "src", "requirementSnapshot", "index.ts");
const producerSource = existsSync(producerPath)
  ? await import("node:fs").then(({ readFileSync }) =>
      readFileSync(producerPath, "utf8"),
    )
  : "";
const verticalExists =
  existsSync(storePath) &&
  /export\s+(?:async\s+)?function\s+extractKecRequirementSnapshot\b/u.test(
    producerSource,
  );
const pdfFixtures: RequirementPdfFixture[] = [];

type Producer = {
  readonly extractKecRequirementSnapshot: (
    input: unknown,
  ) => Promise<KecRequirementExtractionSnapshot>;
};
type Store = {
  storeSnapshot(snapshot: KecRequirementExtractionSnapshot): void;
  loadSnapshot(
    binding: KecRequirementExtractionBinding,
  ): KecRequirementExtractionSnapshot | null;
  close(): void;
};

async function loadProducer(): Promise<Producer> {
  return import(
    /* @vite-ignore */ fileURLToPath(
      new URL("../src/knowledge/requirementExtraction.ts", import.meta.url),
    )
  ) as Promise<Producer>;
}

async function StoreConstructor(): Promise<new (dbPath: string) => Store> {
  const module = (await import(
    /* @vite-ignore */ fileURLToPath(
      new URL("../src/requirementSnapshot/index.ts", import.meta.url),
    )
  )) as { readonly KecRequirementSnapshotStore: new (dbPath: string) => Store };
  return module.KecRequirementSnapshotStore;
}

function fixture(bytes: Uint8Array): RequirementPdfFixture {
  const created = createRequirementPdfFixture(bytes);
  pdfFixtures.push(created);
  return created;
}

afterEach(() => {
  for (const created of pdfFixtures.splice(0)) created.cleanup();
  cleanupTempSnapshotDatabases();
});

describe.runIf(verticalExists)(
  "Task91 source-first vertical persistence",
  () => {
    it("round-trips a real deterministic PDF with extraction order and multi-locator provenance", async () => {
      const created = fixture(
        deterministicKoreanPdfBytes([
          { text: "욕실", x: 72, y: 740, size: 14 },
          { text: "전기기기는 방수형으로 시설하여야 한다", x: 72, y: 714 },
          { text: "점검을 생략할 수 있다", x: 72, y: 660 },
        ]),
      );
      const producer = await loadProducer();
      const snapshot = await producer.extractKecRequirementSnapshot({
        projectRoot: created.projectRoot,
        sourceLocator: created.firstLocator,
        sourceRevision: explicitSourceRevision(),
      });
      expect(snapshot.requirements.length).toBeGreaterThan(1);
      expect(
        snapshot.requirements.some(
          (member) => member.provenance.locators.length > 1,
        ),
      ).toBe(true);

      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      const writer = new Constructor(dbPath);
      writer.storeSnapshot(snapshot);
      writer.close();
      const reader = new Constructor(dbPath);
      expect(reader.loadSnapshot(snapshot.binding)).toEqual(snapshot);
      reader.close();
    });

    it("makes path renames irrelevant when bytes, revision, contract, and locators agree", async () => {
      const created = fixture(deterministicKoreanPdfBytes());
      const producer = await loadProducer();
      const sourceRevision = explicitSourceRevision();
      const first = await producer.extractKecRequirementSnapshot({
        projectRoot: created.projectRoot,
        sourceLocator: created.firstLocator,
        sourceRevision,
      });
      renameSync(
        join(created.projectRoot, created.firstLocator.value),
        join(created.projectRoot, "kec", "moved.pdf"),
      );
      const renamed = await producer.extractKecRequirementSnapshot({
        projectRoot: created.projectRoot,
        sourceLocator: { scheme: "file", value: "kec/moved.pdf" },
        sourceRevision,
      });
      expect(renamed).toEqual(first);

      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      const store = new Constructor(dbPath);
      store.storeSnapshot(first);
      expect(() => store.storeSnapshot(renamed)).not.toThrow();
      expect(store.loadSnapshot(first.binding)).toEqual(first);
      store.close();
    });

    it("persists an empty real extraction while preserving missing versus empty", async () => {
      const created = fixture(
        deterministicKoreanPdfBytes("이 문장은 비규범적인 설명이다"),
      );
      const producer = await loadProducer();
      const snapshot = await producer.extractKecRequirementSnapshot({
        projectRoot: created.projectRoot,
        sourceLocator: created.firstLocator,
        sourceRevision: explicitSourceRevision(),
      });
      expect(snapshot.binding.blobHash).toEqual({
        algorithm: "sha-256",
        digest: createHash("sha256").update(created.bytes).digest("hex"),
      });
      expect(snapshot.requirements).toEqual([]);

      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      const before = new Constructor(dbPath);
      expect(before.loadSnapshot(snapshot.binding)).toBeNull();
      before.storeSnapshot(snapshot);
      before.close();
      const after = new Constructor(dbPath);
      expect(after.loadSnapshot(snapshot.binding)).toEqual(snapshot);
      expect(after.loadSnapshot(snapshot.binding)).not.toBeNull();
      after.close();
    });
  },
);

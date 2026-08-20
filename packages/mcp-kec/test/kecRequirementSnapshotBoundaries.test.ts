import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type {
  KecRequirementExtractionBinding,
  KecRequirementExtractionSnapshot,
} from "../src/knowledge/requirementExtraction.js";
import {
  cleanupTempSnapshotDatabases,
  createTempSnapshotDatabase,
  semanticRows,
  task91Binding,
  task91BlobHash,
  task91Requirement,
  task91Snapshot,
  task91SourceRevision,
  TASK91_ERROR_CATEGORIES,
} from "./fixtures/requirementSnapshotContracts.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const snapshotRoot = join(packageRoot, "src", "requirementSnapshot");
const snapshotIndex = join(snapshotRoot, "index.ts");
const storeExists = existsSync(snapshotIndex);

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

function sourceFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  });
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

describe("Task91 requirementSnapshot production boundary RED gate", () => {
  it("fails explicitly until the production namespace/store entry point exists", () => {
    expect(
      storeExists,
      "Task91 requirementSnapshot production namespace/store is missing: packages/mcp-kec/src/requirementSnapshot/index.ts",
    ).toBe(true);
  });
});

describe.runIf(storeExists)(
  "Task91 persistence boundaries and firewalls",
  () => {
    afterEach(cleanupTempSnapshotDatabases);

    it("rejects member mismatch across all six binding coordinates atomically", async () => {
      const base = task91Snapshot();
      const mismatches: Array<
        readonly [string, KecRequirementExtractionBinding]
      > = [
        [
          "sourceIdentity",
          task91Binding({
            sourceRevision: task91SourceRevision(
              "kec:other",
              "2026-08-19-approved",
            ),
          }),
        ],
        [
          "revisionKey",
          task91Binding({
            sourceRevision: task91SourceRevision(
              "kec:official-standard",
              "other-revision",
            ),
          }),
        ],
        [
          "blobHash.algorithm",
          task91Binding({
            blobHash: {
              algorithm: "sha-512",
              digest: base.binding.blobHash.digest,
            } as never,
          }),
        ],
        [
          "blobHash.digest",
          task91Binding({ blobHash: task91BlobHash("other") }),
        ],
        [
          "extractionContract",
          task91Binding({
            extractionContract: "kec:other-contract:v1" as never,
          }),
        ],
        [
          "locatorSpace",
          task91Binding({ locatorSpace: "kec:other-locator:v1" as never }),
        ],
      ];
      const Constructor = await StoreConstructor();

      for (const [coordinate, memberBinding] of mismatches) {
        const { dbPath } = createTempSnapshotDatabase(`task91-${coordinate}-`);
        const store = new Constructor(dbPath);
        const snapshot = {
          binding: base.binding,
          requirements: [task91Requirement(memberBinding)],
        };
        const before = semanticRows(dbPath);
        expect(categoryOf(() => store.storeSnapshot(snapshot))).toBe(
          "binding-mismatch",
        );
        expect(semanticRows(dbPath), coordinate).toEqual(before);
        store.close();
      }
    });

    it("rejects unknown locator space without changing semantic rows", async () => {
      const valid = task91Snapshot();
      const unsupportedBinding = task91Binding({
        locatorSpace: "kec:unknown-locator-space:v9" as never,
      });
      const unsupported = task91Snapshot(unsupportedBinding);
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      const store = new Constructor(dbPath);
      store.storeSnapshot(valid);
      const before = semanticRows(dbPath);
      expect(categoryOf(() => store.storeSnapshot(unsupported))).toBe(
        "unsupported-locator-space",
      );
      expect(semanticRows(dbPath)).toEqual(before);
      store.close();
    });

    it("makes close idempotent and fails use-after-close with closed", async () => {
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      const store = new Constructor(dbPath);
      expect(store.close()).toBeUndefined();
      expect(store.close()).toBeUndefined();
      expect(categoryOf(() => store.loadSnapshot(task91Binding()))).toBe(
        "closed",
      );
      expect(categoryOf(() => store.storeSnapshot(task91Snapshot()))).toBe(
        "closed",
      );
    });

    it("exports exactly the nine frozen error categories", () => {
      const source = sourceFiles(snapshotRoot)
        .map((path) => readFileSync(path, "utf8"))
        .join("\n");
      const categoryLiterals = new Set(
        [
          ...source.matchAll(
            /"(binding-mismatch|unsupported-locator-space|snapshot-conflict|locator-encode|locator-decode|member-corruption|schema|storage|closed)"/gu,
          ),
        ].map((match) => match[1]),
      );
      expect([...categoryLiterals].sort()).toEqual(
        [...TASK91_ERROR_CATEGORIES].sort(),
      );
      expect(source).not.toMatch(
        /RequirementSnapshotErrorCategory[\s\S]*?\|\s*"(?:query|delete|migration|latest)"/u,
      );
    });

    it("enforces query, governance, identity-creep, and acquisition firewalls", () => {
      const source = sourceFiles(snapshotRoot)
        .map((path) => readFileSync(path, "utf8"))
        .join("\n");
      expect(source).not.toMatch(
        /KnowledgeQueryPort|Task86|searchKec|search_kec|\bLIKE\b|\bMATCH\b|\bFTS\b|embedding|vector|similarity|topK|score|rank|weight|relevance/iu,
      );
      expect(source).not.toMatch(
        /RequirementApplicability|RequirementConflict|ResolutionQuestion|ResolutionJudgement|precedence|priority|authority|winner|current|latest|effective|PromotionGate|\bDecision\b|supersession/iu,
      );
      expect(source).not.toMatch(
        /@voltai\/(?:resolution-core|validation-core|promotion-core|decision-sqlite)/u,
      );
      expect(source).not.toMatch(
        /RequirementProvenance|SourceRegistry|RequirementCandidate|SourceRequirementAssertion|RequirementPopulationId|RequirementSetId|ExtractionRunId|randomUUID|Math\.random|Date\.now|created_at|timestamp/iu,
      );
      expect(source).not.toMatch(
        /node:fs|pdfjs-dist|projectPath|readFile|readKecPdfBytes|sourceBlobHash|parseKecPdf/iu,
      );
      expect(source).not.toContain("../knowledge/projectPath.js");
    });

    it("does not expose merge, replacement, deletion, pruning, or generic codecs", () => {
      const source = sourceFiles(snapshotRoot)
        .map((path) => readFileSync(path, "utf8"))
        .join("\n");
      expect(source).not.toMatch(
        /StoredRequirementEntry|RequirementKeyCodec|RequirementLocatorCodec|locator child table|mergeSnapshot|replaceSnapshot|deleteSnapshot|pruneSnapshot/iu,
      );
    });
  },
);

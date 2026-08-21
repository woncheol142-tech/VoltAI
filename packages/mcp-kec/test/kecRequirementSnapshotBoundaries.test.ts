import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import * as ts from "typescript";
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
  TASK93_ERROR_CATEGORIES,
} from "./fixtures/requirementSnapshotContracts.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const snapshotRoot = join(packageRoot, "src", "requirementSnapshot");
const snapshotIndex = join(snapshotRoot, "index.ts");
const snapshotErrors = join(snapshotRoot, "errors.ts");
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

function exportedErrorCategoryLiterals(): readonly string[] {
  const source = readFileSync(snapshotErrors, "utf8");
  const sourceFile = ts.createSourceFile(
    snapshotErrors,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = sourceFile.statements.filter(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) &&
      statement.name.text === "KecRequirementSnapshotErrorCategory" &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ) === true,
  );
  expect(
    declarations,
    "errors.ts must export exactly one KecRequirementSnapshotErrorCategory type alias",
  ).toHaveLength(1);
  const declaration = declarations[0];
  expect(declaration && ts.isUnionTypeNode(declaration.type)).toBe(true);
  if (!declaration || !ts.isUnionTypeNode(declaration.type)) return [];

  return declaration.type.types.map((member) => {
    expect(
      ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal),
      "every KecRequirementSnapshotErrorCategory union member must be a string literal type",
    ).toBe(true);
    if (!ts.isLiteralTypeNode(member) || !ts.isStringLiteral(member.literal)) {
      return "<non-string-literal>";
    }
    return member.literal.text;
  });
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

    it("retains all nine Task91 categories in the Task93 taxonomy", () => {
      const exportedCategories = exportedErrorCategoryLiterals();
      expect(
        TASK91_ERROR_CATEGORIES.every((category) =>
          exportedCategories.includes(category),
        ),
      ).toBe(true);
      expect(new Set(exportedCategories).size).toBe(exportedCategories.length);
      expect(exportedCategories).not.toEqual(
        expect.arrayContaining(["query", "delete", "migration", "latest"]),
      );
    });

    it("exports exactly the thirteen frozen Task93 error categories", () => {
      const exportedCategories = exportedErrorCategoryLiterals();
      expect([...exportedCategories].sort()).toEqual(
        [...TASK93_ERROR_CATEGORIES].sort(),
      );
      expect(new Set(exportedCategories).size).toBe(13);
      expect(TASK93_ERROR_CATEGORIES).toHaveLength(13);
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

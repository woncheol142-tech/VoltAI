import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  captureError,
  compatibilityErrorSentinels,
  foreignSourcePath,
  indexCompatibilityHarness,
  indexMetadata,
  incomingSourcePath,
  kecChunk,
  providerMetadata,
} from "./helpers/kecIndexWriteCompatibilityFixture.js";

const sqliteVectorStoreConstructor = vi.hoisted(() => vi.fn());
const readPdfPagesMock = vi.hoisted(() =>
  vi.fn(async () => [
    { page: 1, text: "KEC 232.5 cable sizing rule for compatibility" },
  ]),
);

vi.mock("../src/knowledge/pdfPages.js", () => ({
  readPdfPages: readPdfPagesMock,
}));

vi.mock("../src/knowledge/projectPath.js", () => ({
  assertProjectRoot: (root: string | undefined) => root ?? "/virtual/project",
  resolveKecPdfPath: (_root: string, relativePath: string) =>
    `/virtual/project/${relativePath}`,
}));

vi.mock("../src/knowledge/sqliteVectorStore.js", () => ({
  SqliteVectorStore: function SqliteVectorStore(path: string) {
    return sqliteVectorStoreConstructor(path);
  },
}));

import { createIndexKecTool, indexKec } from "../src/tools/indexKec.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const sourceRoot = join(packageRoot, "src");
const compatibilitySource = join(
  sourceRoot,
  "knowledge",
  "indexCompatibility.ts",
);
const indexToolSource = join(sourceRoot, "tools", "indexKec.ts");
const packageManifest = join(packageRoot, "package.json");
const workspaceReadme = join(workspaceRoot, "README.md");
const task56ReadmeStart = "<!-- TASK 56 KEC INDEX DIAGNOSTICS START -->";
const task56ReadmeEnd = "<!-- TASK 56 KEC INDEX DIAGNOSTICS END -->";
const task57ReadmeStart = "<!-- TASK57_OLLAMA_EMBEDDING_SMOKE_START -->";
const task57ReadmeEnd = "<!-- TASK57_OLLAMA_EMBEDDING_SMOKE_END -->";

type PackageManifest = Readonly<Record<string, unknown>> &
  Readonly<{
    scripts: Readonly<Record<string, string>>;
  }>;

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

function readHeadFile(relativePath: string): string {
  return execFileSync("git", ["show", `HEAD:${relativePath}`], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
}

function expectFutureTask57ReadmeAddition(
  currentReadme: string,
  headReadme: string,
): void {
  expect(currentReadme.split(task56ReadmeStart)).toHaveLength(2);
  expect(currentReadme.split(task56ReadmeEnd)).toHaveLength(2);

  const start = currentReadme.indexOf(task56ReadmeStart);
  const markerEnd = currentReadme.indexOf(task56ReadmeEnd, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(markerEnd).toBeGreaterThan(start);

  expect(currentReadme.split(task57ReadmeStart)).toHaveLength(2);
  expect(currentReadme.split(task57ReadmeEnd)).toHaveLength(2);
  const task57Start = currentReadme.indexOf(task57ReadmeStart);
  const task57MarkerEnd = currentReadme.indexOf(task57ReadmeEnd, task57Start);
  expect(task57Start).toBeGreaterThanOrEqual(0);
  expect(task57MarkerEnd).toBeGreaterThan(task57Start);

  const task57End = task57MarkerEnd + task57ReadmeEnd.length;
  let reconstructsHead = false;
  for (let before = 0; before <= 2; before += 1) {
    for (let after = 0; after <= 2; after += 1) {
      const removalStart = task57Start - before;
      const removalEnd = task57End + after;
      if (removalStart < 0 || removalEnd > currentReadme.length) continue;
      if (!/^\n*$/u.test(currentReadme.slice(removalStart, task57Start))) {
        continue;
      }
      if (!/^\n*$/u.test(currentReadme.slice(task57End, removalEnd))) {
        continue;
      }
      reconstructsHead ||=
        `${currentReadme.slice(0, removalStart)}${currentReadme.slice(removalEnd)}` ===
        headReadme;
    }
  }
  expect(reconstructsHead).toBe(true);
}

function expectFutureSmokePackageAddition(): void {
  const currentPackage = JSON.parse(
    readSource(packageManifest),
  ) as PackageManifest;
  const headPackage = JSON.parse(
    readHeadFile("packages/mcp-kec/package.json"),
  ) as PackageManifest;

  expect(currentPackage).toEqual({
    ...headPackage,
    scripts: {
      ...headPackage.scripts,
      "inspect:index": "tsx src/inspectIndex.ts",
      "smoke:ollama": "tsx src/smokeOllamaEmbedding.ts",
    },
  });
  expect(currentPackage.scripts["inspect:index"]).toBe(
    "tsx src/inspectIndex.ts",
  );
  expect(currentPackage.scripts["smoke:ollama"]).toBe(
    "tsx src/smokeOllamaEmbedding.ts",
  );
}

describe("KEC index write compatibility architecture boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reserves the internal compatibility module without package-root export", () => {
    expect(existsSync(compatibilitySource)).toBe(true);

    const packageIndex = readSource(join(sourceRoot, "index.ts"));
    expect(packageIndex).not.toMatch(
      /indexCompatibility|assertKecIndexWriteCompatibility/u,
    );
  });

  it("keeps package, README, runtime, environment, chunking, search, and storage boundaries protected", () => {
    for (const relativePath of [
      "packages/mcp-kec/package.json",
      "packages/mcp-kec/src/index.ts",
      "packages/mcp-kec/src/hybrid.ts",
      "packages/mcp-kec/src/knowledge/chunk.ts",
      "packages/mcp-kec/src/knowledge/embedding.ts",
      "packages/mcp-kec/src/knowledge/sqliteVectorStore.ts",
      "packages/mcp-kec/src/tools/searchKec.ts",
      "packages/mcp-kec/src/tools/searchKecHybrid.ts",
      "packages/knowledge-sqlite/src/sqliteKnowledgeStore.ts",
      "package.json",
      "pnpm-lock.yaml",
      "README.md",
      ".env.example",
    ]) {
      if (relativePath === "packages/mcp-kec/package.json") {
        expectFutureSmokePackageAddition();
        continue;
      }
      if (relativePath === "README.md") {
        expectFutureTask57ReadmeAddition(
          readSource(workspaceReadme),
          readHeadFile("README.md"),
        );
        continue;
      }

      expect(readSource(join(workspaceRoot, relativePath))).toBe(
        readHeadFile(relativePath),
      );
    }
  });

  it("keeps the default and explicit hybrid tool registration contracts unchanged", () => {
    const packageIndex = readSource(join(sourceRoot, "index.ts"));
    const hybridRuntime = readSource(join(sourceRoot, "hybrid.ts"));

    expect(packageIndex).toMatch(
      /const tools: VoltAiTool\[\] = \[\s*placeholderTool,\s*createIndexKecTool\(\),\s*createSearchKecTool\(\),\s*\];/u,
    );
    expect(packageIndex).toContain(
      "tools.push(createSearchKecHybridTool(options.hybridSearch));",
    );
    expect(hybridRuntime).toContain("createHybridServer");
    expect(hybridRuntime).toContain("KEC_HYBRID_SEMANTIC_WEIGHT");
    expect(hybridRuntime).toContain("KEC_HYBRID_LEXICAL_WEIGHT");
    expect(packageIndex).not.toContain("KEC_INDEX_COMPATIBILITY");
    expect(hybridRuntime).not.toContain("KEC_INDEX_COMPATIBILITY");
  });

  it("places one pure guard after embedding and one metadata snapshot but before replaceSource", () => {
    const source = readSource(indexToolSource);
    const embeddingPosition = source.indexOf("mapWithConcurrencyAndRetry(");
    const metadataPosition = source.indexOf("getMetadata()");
    const metadataReadPosition = source.indexOf("getIndexMetadata(");
    const chunkReadPosition = source.indexOf("listChunks(");
    const guardPosition = source.indexOf("assertKecIndexWriteCompatibility(");
    const replacePosition = source.indexOf("replaceSource(");

    expect(source.match(/\.getMetadata\s*\(\)/gu)).toHaveLength(1);
    expect(
      source.match(/assertKecIndexWriteCompatibility\s*\(/gu),
    ).toHaveLength(1);
    expect(embeddingPosition).toBeGreaterThanOrEqual(0);
    expect(metadataPosition).toBeGreaterThan(embeddingPosition);
    expect(metadataReadPosition).toBeGreaterThan(metadataPosition);
    expect(chunkReadPosition).toBeGreaterThan(metadataReadPosition);
    expect(guardPosition).toBeGreaterThan(chunkReadPosition);
    expect(replacePosition).toBeGreaterThan(guardPosition);
  });

  it("keeps the helper pure and free of PDF, embedding, store, repair, status, agent, or side-effect logic", () => {
    expect(existsSync(compatibilitySource)).toBe(true);
    const source = readSource(compatibilitySource);

    expect(source).not.toMatch(
      /node:|process\.|fetch\s*\(|XMLHttpRequest|WebSocket|Sqlite|VectorStore|EmbeddingProvider|readPdf|createPageChunks|replaceSource|deleteBySourcePath|saveIndexMetadata|console\.|logger|repair|status|agent-review|mcp-agent/iu,
    );
    expect(source).not.toMatch(
      /\b(?:eval|Function)\s*\(|new\s+Function|child_process/iu,
    );
    expect(source).not.toMatch(/^(?:export\s+)?(?:let|var)\s+/mu);
    expect(source).not.toMatch(/\b(?:Map|Set|WeakMap|WeakSet)\b/u);
  });
});

describe("KEC index write compatibility integration boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads provider metadata once and persists values from that same snapshot", async () => {
    const first = providerMetadata({ provider: "first", model: "first-model" });
    const second = providerMetadata({
      provider: "second",
      model: "second-model",
    });
    const harness = indexCompatibilityHarness({
      metadataSequence: [first, second],
      existingMetadata: indexMetadata({
        embeddingProvider: first.provider,
        embeddingModel: first.model,
      }),
      existingChunks: [kecChunk({ sourcePath: foreignSourcePath })],
    });

    await indexKec(
      "/virtual/project",
      { relativePath: incomingSourcePath },
      harness,
    );

    expect(harness.getMetadata).toHaveBeenCalledTimes(1);
    expect(harness.getIndexMetadata).toHaveBeenCalledTimes(1);
    expect(harness.listChunks).toHaveBeenCalledTimes(1);
    expect(harness.replaceSource).toHaveBeenCalledTimes(1);
    expect(harness.replaceSource.mock.calls[0]?.[3]).toMatchObject({
      embeddingProvider: first.provider,
      embeddingModel: first.model,
      dimensions: 3,
    });
  });

  it("allows empty-index and same-source-only writes after inspecting existing state", async () => {
    for (const harness of [
      indexCompatibilityHarness(),
      indexCompatibilityHarness({
        existingMetadata: indexMetadata({
          embeddingProvider: "legacy",
          embeddingModel: "legacy-model",
          dimensions: 2,
        }),
        existingChunks: [kecChunk({ sourcePath: incomingSourcePath })],
      }),
    ]) {
      await expect(
        indexKec(
          "/virtual/project",
          { relativePath: incomingSourcePath },
          harness,
        ),
      ).resolves.toEqual({
        relativePath: incomingSourcePath,
        indexedChunks: 1,
      });
      expect(harness.getIndexMetadata).toHaveBeenCalledTimes(1);
      expect(harness.listChunks).toHaveBeenCalledTimes(1);
      expect(harness.replaceSource).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    {
      name: "missing metadata",
      existingMetadata: null,
      prefix: "MISSING_INDEX_METADATA",
    },
    {
      name: "provider mismatch",
      existingMetadata: indexMetadata({ embeddingProvider: "other" }),
      prefix: "PROVIDER_MISMATCH",
    },
    {
      name: "model mismatch",
      existingMetadata: indexMetadata({ embeddingModel: "other" }),
      prefix: "MODEL_MISMATCH",
    },
    {
      name: "dimension mismatch",
      existingMetadata: indexMetadata({ dimensions: 2 }),
      prefix: "DIMENSION_MISMATCH",
    },
  ])("fails foreign-source $name before any write", async (testCase) => {
    const harness = indexCompatibilityHarness({
      existingMetadata: testCase.existingMetadata,
      existingChunks: [kecChunk({ sourcePath: foreignSourcePath })],
    });
    const error = await captureError(() =>
      indexKec(
        "/virtual/project",
        { relativePath: incomingSourcePath },
        harness,
      ),
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      `KEC_INDEX_COMPATIBILITY: ${testCase.prefix}`,
    );
    expect(harness.replaceSource).not.toHaveBeenCalled();
    expect(harness.saveIndexMetadata).not.toHaveBeenCalled();
  });

  it("propagates metadata and chunk listing errors by identity without writes", async () => {
    const sentinels = compatibilityErrorSentinels();
    const metadataError = sentinels.getIndexMetadata;
    const metadataHarness = indexCompatibilityHarness({
      getIndexMetadataError: metadataError,
    });

    expect(
      await captureError(() =>
        indexKec(
          "/virtual/project",
          { relativePath: incomingSourcePath },
          metadataHarness,
        ),
      ),
    ).toBe(metadataError);
    expect(metadataHarness.replaceSource).not.toHaveBeenCalled();

    const chunksError = sentinels.listChunks;
    const chunksHarness = indexCompatibilityHarness({
      listChunksError: chunksError,
    });

    expect(
      await captureError(() =>
        indexKec(
          "/virtual/project",
          { relativePath: incomingSourcePath },
          chunksHarness,
        ),
      ),
    ).toBe(chunksError);
    expect(chunksHarness.replaceSource).not.toHaveBeenCalled();
  });

  it("propagates provider metadata errors by identity without writes", async () => {
    const providerError = compatibilityErrorSentinels().providerMetadata;
    const harness = indexCompatibilityHarness({
      providerMetadataError: providerError,
    });

    expect(
      await captureError(() =>
        indexKec(
          "/virtual/project",
          { relativePath: incomingSourcePath },
          harness,
        ),
      ),
    ).toBe(providerError);
    expect(harness.replaceSource).not.toHaveBeenCalled();
  });

  it("does not close an injected caller-owned store after compatibility failure", async () => {
    const harness = indexCompatibilityHarness({
      existingMetadata: indexMetadata({ embeddingProvider: "other" }),
      existingChunks: [kecChunk({ sourcePath: foreignSourcePath })],
    });
    const tool = createIndexKecTool(harness);
    const error = await captureError(() =>
      tool.handler({ relativePath: incomingSourcePath }),
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^KEC_INDEX_COMPATIBILITY:/u);
    expect(harness.close).not.toHaveBeenCalled();
    expect(harness.replaceSource).not.toHaveBeenCalled();
  });

  it("closes the existing tool-owned store exactly once after compatibility failure", async () => {
    const harness = indexCompatibilityHarness({
      existingMetadata: indexMetadata({ embeddingProvider: "other" }),
      existingChunks: [kecChunk({ sourcePath: foreignSourcePath })],
    });
    sqliteVectorStoreConstructor.mockReturnValue(harness.vectorStore);
    const tool = createIndexKecTool({
      embeddingProvider: harness.embeddingProvider,
    });
    const error = await captureError(() =>
      tool.handler({ relativePath: incomingSourcePath }),
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^KEC_INDEX_COMPATIBILITY:/u);
    expect(harness.close).toHaveBeenCalledTimes(1);
    expect(harness.replaceSource).not.toHaveBeenCalled();
  });
});

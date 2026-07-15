import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { writeDrawingSearchIndex } from "./helpers/drawingSearchFixture.js";

type SearchDrawingsResult = {
  query: string;
  normalizedQuery: string;
  resultCount: number;
  totalCandidates: number;
  results: Array<{ drawingNo: string; score: number }>;
  warnings: string[];
};

type SearchDrawings = (
  projectRoot: string | undefined,
  input: unknown,
) => Promise<SearchDrawingsResult>;

type SearchDrawingsTool = {
  name: string;
  handler(input: unknown): Promise<SearchDrawingsResult>;
};

const toolModulePath = "../src/tools/searchDrawings.js";
const roots: string[] = [];

async function loadToolModule(): Promise<{
  searchDrawings: SearchDrawings;
  createSearchDrawingsTool(): SearchDrawingsTool;
}> {
  return (await import(toolModulePath)) as {
    searchDrawings: SearchDrawings;
    createSearchDrawingsTool(): SearchDrawingsTool;
  };
}

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "voltai-search-drawings-"));
  roots.push(root);
  writeDrawingSearchIndex(root);
  return root;
}

describe("searchDrawings tool function", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns the typed search result from a stored index", async () => {
    const root = tempRoot();
    const { searchDrawings } = await loadToolModule();

    const result = await searchDrawings(root, {
      indexPath: ".volt-ai/indexes/drawing-index.json",
      query: "E401",
    });

    expect(typeof result).not.toBe("string");
    expect(result).toMatchObject({
      query: "E401",
      normalizedQuery: "E-401",
      resultCount: 1,
      totalCandidates: 1,
    });
    expect(result.results[0]).toMatchObject({ drawingNo: "E-401", score: 1 });
  });

  it("creates a VoltAiTool with a typed object handler", async () => {
    const root = tempRoot();
    const originalRoot = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;

    try {
      const { createSearchDrawingsTool } = await loadToolModule();
      const tool = createSearchDrawingsTool();
      const result = await tool.handler({
        indexPath: ".volt-ai/indexes/drawing-index.json",
        query: "수변전 단선결선도",
      });

      expect(tool.name).toBe("search_drawings");
      expect(typeof result).not.toBe("string");
      expect(result.results.map((drawing) => drawing.drawingNo)).toEqual(["E-111", "E-112"]);
    } finally {
      if (originalRoot === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = originalRoot;
    }
  });

  it.each([
    [{ query: "전등" }, /indexPath/i],
    [{ indexPath: ".volt-ai/indexes/drawing-index.json" }, /query/i],
    [{ indexPath: ".volt-ai/indexes/drawing-index.json", query: "전등", limit: 0 }, /limit/i],
    [
      {
        indexPath: ".volt-ai/indexes/drawing-index.json",
        query: "전등",
        filters: { category: "invalid" },
      },
      /category/i,
    ],
  ])("rejects invalid input %#", async (input, message) => {
    const root = tempRoot();
    const { searchDrawings } = await loadToolModule();

    await expect(searchDrawings(root, input)).rejects.toThrow(message);
  });

  it.each([
    { relativePath: "docs/drawing-list.pdf" },
    { startPage: 2 },
    { endPage: 9 },
  ])("rejects unsupported PDF indexing input %#", async (unsupported) => {
    const root = tempRoot();
    const { searchDrawings } = await loadToolModule();

    await expect(
      searchDrawings(root, {
        indexPath: ".volt-ai/indexes/drawing-index.json",
        query: "전등",
        ...unsupported,
      }),
    ).rejects.toThrow(/unsupported|unknown|input/i);
  });

  it("returns zero results as a normal typed response", async () => {
    const root = tempRoot();
    const { searchDrawings } = await loadToolModule();

    await expect(
      searchDrawings(root, {
        indexPath: ".volt-ai/indexes/drawing-index.json",
        query: "E-9999",
      }),
    ).resolves.toMatchObject({
      resultCount: 0,
      totalCandidates: 0,
      results: [],
      warnings: expect.arrayContaining(["lexical search did not find a match"]),
    });
  });
});

import { rmSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { VoltAiTool } from "@voltai/mcp-core";
import { afterEach, describe, expect, it } from "vitest";

import { createServer } from "../src/index.js";
import { createTempPdfProject } from "./helpers/pdfFixture.js";
import {
  writeDrawingPageMapProject,
  type DrawingPageMapFixtureDocument,
} from "./helpers/drawingPageMapFixture.js";

const toolModulePath = "../src/tools/mapDrawingPages.js";
const roots: string[] = [];

async function loadToolFactory(): Promise<() => VoltAiTool<DrawingPageMapFixtureDocument>> {
  const module = (await import(toolModulePath)) as {
    createMapDrawingPagesTool: () => VoltAiTool<DrawingPageMapFixtureDocument>;
  };
  return module.createMapDrawingPagesTool;
}

function tempRoot(): string {
  const root = createTempPdfProject();
  roots.push(root);
  return root;
}

async function connectServer() {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "map-drawing-pages-test-client", version: "0.1.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

function responseText(response: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = response.content[0];
  expect(content).toMatchObject({ type: "text" });
  return (content as { type: "text"; text: string }).text;
}

describe("map_drawing_pages MCP boundary", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("uses a typed object handler contract", async () => {
    const root = tempRoot();
    writeDrawingPageMapProject(root);
    const createMapDrawingPagesTool = await loadToolFactory();
    const originalRoot = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;

    try {
      const result = await createMapDrawingPagesTool().handler({
        relativePath: "docs/drawings.pdf",
        indexPath: ".volt-ai/indexes/drawing-index.json",
      });
      expect(result).toMatchObject({ schemaVersion: 1, mappingCount: 5 });
      expect(typeof result).toBe("object");
    } finally {
      if (originalRoot === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = originalRoot;
    }
  });

  it("lists map_drawing_pages and the optional search pageMapPath schema", async () => {
    const { client, server } = await connectServer();

    try {
      const tools = await client.listTools();
      const mapTool = tools.tools.find(({ name }) => name === "map_drawing_pages");
      const searchTool = tools.tools.find(({ name }) => name === "search_drawings");

      expect(mapTool?.inputSchema.required).toEqual(["relativePath", "indexPath"]);
      expect(mapTool?.inputSchema.properties).toMatchObject({
        relativePath: expect.any(Object),
        indexPath: expect.any(Object),
        startPage: expect.any(Object),
        endPage: expect.any(Object),
        outputName: expect.any(Object),
      });
      expect(searchTool?.inputSchema.properties).toHaveProperty("pageMapPath");
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });

  it("serializes a typed page-map result as protocol JSON text", async () => {
    const root = tempRoot();
    writeDrawingPageMapProject(root);
    const originalRoot = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;
    const { client, server } = await connectServer();

    try {
      const response = await client.callTool({
        name: "map_drawing_pages",
        arguments: {
          relativePath: "docs/drawings.pdf",
          indexPath: ".volt-ai/indexes/drawing-index.json",
        },
      });
      const parsed = JSON.parse(responseText(response)) as DrawingPageMapFixtureDocument;

      expect(response.isError).not.toBe(true);
      expect(parsed).toMatchObject({ schemaVersion: 1, mappingCount: 5, unmatchedCount: 2 });
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
      if (originalRoot === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = originalRoot;
    }
  });

  it("maps invalid input to an MCP error result", async () => {
    const { client, server } = await connectServer();

    try {
      const response = await client.callTool({
        name: "map_drawing_pages",
        arguments: { relativePath: "docs/drawings.pdf", indexPath: "index.json", startPage: 0 },
      });

      expect(response.isError).toBe(true);
      expect(responseText(response)).toMatch(/startPage|positive|invalid/i);
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });

  it("returns zero mappings as a successful protocol result", async () => {
    const root = tempRoot();
    const base = writeDrawingPageMapProject(root);
    const onlyUnknown = {
      ...base.index.drawings[0]!,
      drawingNo: "E-999",
      title: "분할본에 없는 도면",
    };
    writeDrawingPageMapProject(root, {
      indexOverrides: { drawings: [onlyUnknown], drawingCount: 1 },
    });
    const originalRoot = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;
    const { client, server } = await connectServer();

    try {
      const response = await client.callTool({
        name: "map_drawing_pages",
        arguments: {
          relativePath: "docs/drawings.pdf",
          indexPath: ".volt-ai/indexes/drawing-index.json",
        },
      });
      const parsed = JSON.parse(responseText(response)) as DrawingPageMapFixtureDocument;

      expect(response.isError).not.toBe(true);
      expect(parsed).toMatchObject({ mappingCount: 0, coverageRatio: 0 });
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
      if (originalRoot === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = originalRoot;
    }
  });

  it("returns partial PDF coverage as a successful protocol result", async () => {
    const root = tempRoot();
    writeDrawingPageMapProject(root);
    const originalRoot = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;
    const { client, server } = await connectServer();

    try {
      const response = await client.callTool({
        name: "map_drawing_pages",
        arguments: {
          relativePath: "docs/drawings.pdf",
          indexPath: ".volt-ai/indexes/drawing-index.json",
        },
      });
      const parsed = JSON.parse(responseText(response)) as DrawingPageMapFixtureDocument;

      expect(response.isError).not.toBe(true);
      expect(parsed.mappingCount).toBeLessThan(parsed.indexedDrawingCount);
      expect(parsed.unmatchedCount).toBeGreaterThan(0);
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
      if (originalRoot === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = originalRoot;
    }
  });

  it("round-trips page-map enrichment through search_drawings", async () => {
    const root = tempRoot();
    writeDrawingPageMapProject(root);
    const originalRoot = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;
    const { client, server } = await connectServer();

    try {
      const mapResponse = await client.callTool({
        name: "map_drawing_pages",
        arguments: {
          relativePath: "docs/drawings.pdf",
          indexPath: ".volt-ai/indexes/drawing-index.json",
          outputName: "drawing-pages",
        },
      });
      const pageMap = JSON.parse(responseText(mapResponse)) as DrawingPageMapFixtureDocument;
      const searchResponse = await client.callTool({
        name: "search_drawings",
        arguments: {
          indexPath: ".volt-ai/indexes/drawing-index.json",
          pageMapPath: pageMap.relativePageMapPath,
          query: "E401",
        },
      });
      const searchResult = JSON.parse(responseText(searchResponse)) as {
        results: Array<{ drawingNo: string; drawingPage: number | null }>;
      };

      expect(searchResponse.isError).not.toBe(true);
      expect(searchResult.results[0]).toMatchObject({ drawingNo: "E-401", drawingPage: null });
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
      if (originalRoot === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = originalRoot;
    }
  });
});

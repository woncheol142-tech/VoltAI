import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { createServer } from "../src/index.js";
import { writeDrawingSearchIndex } from "./helpers/drawingSearchFixture.js";

type ProtocolSearchResult = {
  query: string;
  normalizedQuery: string;
  resultCount: number;
  totalCandidates: number;
  results: Array<{ drawingNo: string; score: number }>;
  warnings: string[];
};

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "voltai-search-drawings-mcp-"));
  roots.push(root);
  writeDrawingSearchIndex(root);
  return root;
}

async function connectServer() {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "search-drawings-test-client", version: "0.1.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content[0];
  expect(content).toMatchObject({ type: "text" });
  return (content as { type: "text"; text: string }).text;
}

describe("search_drawings MCP contract", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exposes search_drawings with only the stored-index search schema", async () => {
    const { client, server } = await connectServer();

    try {
      const tools = await client.listTools();
      const tool = tools.tools.find((candidate) => candidate.name === "search_drawings");

      expect(tool?.inputSchema.required).toEqual(["indexPath", "query"]);
      expect(tool?.inputSchema.properties).toMatchObject({
        indexPath: expect.any(Object),
        query: expect.any(Object),
        limit: expect.any(Object),
        filters: expect.any(Object),
      });
      expect(tool?.inputSchema.properties).not.toHaveProperty("relativePath");
      expect(tool?.inputSchema.properties).not.toHaveProperty("startPage");
      expect(tool?.inputSchema.properties).not.toHaveProperty("endPage");
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });

  it("serializes a typed result as JSON text across the protocol", async () => {
    const root = tempRoot();
    const originalRoot = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;
    const { client, server } = await connectServer();

    try {
      const response = await client.callTool({
        name: "search_drawings",
        arguments: {
          indexPath: ".volt-ai/indexes/drawing-index.json",
          query: "E401",
        },
      });
      const parsed = JSON.parse(textContent(response)) as ProtocolSearchResult;

      expect(response.isError).not.toBe(true);
      expect(parsed).toMatchObject({
        query: "E401",
        normalizedQuery: "E-401",
        resultCount: 1,
        totalCandidates: 1,
      });
      expect(parsed.results[0]).toMatchObject({ drawingNo: "E-401", score: 1 });
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
      if (originalRoot === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = originalRoot;
    }
  });

  it("maps invalid input to the existing MCP error result", async () => {
    const { client, server } = await connectServer();

    try {
      const response = await client.callTool({
        name: "search_drawings",
        arguments: {
          indexPath: ".volt-ai/indexes/index.json",
          query: "전등",
          limit: 0,
        },
      });

      expect(response.isError).toBe(true);
      expect(textContent(response)).toMatch(/limit/i);
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });

  it("maps loader failures to the existing MCP error result", async () => {
    const root = tempRoot();
    const originalRoot = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;
    const { client, server } = await connectServer();

    try {
      const response = await client.callTool({
        name: "search_drawings",
        arguments: {
          indexPath: ".volt-ai/indexes/missing.json",
          query: "전등",
        },
      });

      expect(response.isError).toBe(true);
      expect(textContent(response)).toMatch(/index|exist|file/i);
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
      if (originalRoot === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = originalRoot;
    }
  });

  it("returns zero matches as a successful protocol result", async () => {
    const root = tempRoot();
    const originalRoot = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;
    const { client, server } = await connectServer();

    try {
      const response = await client.callTool({
        name: "search_drawings",
        arguments: {
          indexPath: ".volt-ai/indexes/drawing-index.json",
          query: "E-9999",
        },
      });
      const parsed = JSON.parse(textContent(response)) as ProtocolSearchResult;

      expect(response.isError).not.toBe(true);
      expect(parsed).toMatchObject({ resultCount: 0, totalCandidates: 0, results: [] });
      expect(parsed.warnings).toContain("lexical search did not find a match");
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
      if (originalRoot === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = originalRoot;
    }
  });
});

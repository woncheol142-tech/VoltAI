import { existsSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  companyMcpEnvironment,
  connectInMemoryMcp,
  createCompanyMcpFixture,
  loadMcpCompany,
  readToolText,
  type CompanyMcpFixture,
} from "./helpers/companyMcpHarness.js";

const fixtures: CompanyMcpFixture[] = [];

function createFixture(): CompanyMcpFixture {
  const fixture = createCompanyMcpFixture();
  fixtures.push(fixture);
  return fixture;
}

describe("mcp-company protocol", () => {
  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.cleanup();
    }
    vi.unstubAllGlobals();
  });

  it("exposes index_company and search_company schemas", async () => {
    const fixture = createFixture();
    const environment = companyMcpEnvironment(fixture);
    const { createServer } = await loadMcpCompany();
    const connection = await connectInMemoryMcp(createServer({ environment }));

    try {
      const result = await connection.client.listTools();
      const indexTool = result.tools.find((tool) => tool.name === "index_company");
      const searchTool = result.tools.find((tool) => tool.name === "search_company");

      expect(indexTool?.inputSchema.properties).toEqual(
        expect.objectContaining({
          relativePath: expect.any(Object),
          standardId: expect.any(Object),
          title: expect.any(Object),
          revision: expect.any(Object),
          effectiveDate: expect.any(Object),
          department: expect.any(Object),
          chunkSize: expect.any(Object),
          chunkOverlap: expect.any(Object),
        }),
      );
      expect(searchTool?.inputSchema.properties).toEqual(
        expect.objectContaining({
          query: expect.any(Object),
          topK: expect.any(Object),
        }),
      );
    } finally {
      await connection.close();
    }
  }, 15_000);

  it("round-trips index and search as JSON text through a real MCP server", async () => {
    const fixture = createFixture();
    const environment = companyMcpEnvironment(fixture);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { createServer } = await loadMcpCompany();
    const connection = await connectInMemoryMcp(createServer({ environment }));

    try {
        const indexResponse = await connection.client.callTool({
          name: "index_company",
          arguments: {
            relativePath: fixture.pdfRelativePath,
            standardId: "CS-ELEC-001",
            title: "Electrical Design Standard",
            revision: "A",
            effectiveDate: "2026-07-01",
            department: "Engineering",
          },
        });
        const indexResult = JSON.parse(readToolText(indexResponse)) as {
          relativePath: string;
          standardId: string;
          indexedChunks: number;
        };

        expect(indexResponse.isError).not.toBe(true);
        expect(indexResult).toEqual({
          relativePath: fixture.pdfRelativePath,
          standardId: "CS-ELEC-001",
          indexedChunks: 2,
        });
        expect(existsSync(fixture.dbPath)).toBe(true);

        const searchResponse = await connection.client.callTool({
          name: "search_company",
          arguments: { query: "grounding", topK: 1 },
        });
        const searchResult = JSON.parse(readToolText(searchResponse)) as {
          results: Array<Record<string, unknown>>;
        };

        expect(searchResponse.isError).not.toBe(true);
        expect(searchResult.results).toHaveLength(1);
        expect(searchResult.results[0]).toEqual({
          chunkId: "company:standards/electrical-standard.pdf#page=1#chunk=0",
          sourcePath: fixture.pdfRelativePath,
          page: 1,
          standardId: "CS-ELEC-001",
          title: "Electrical Design Standard",
          section: null,
          text: expect.stringContaining("grounding conductors"),
          similarity: expect.any(Number),
        });
        expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await connection.close();
      expect(connection.isClosed()).toBe(true);
    }
  }, 15_000);

  it("closes a tool-owned store after indexing", async () => {
    const fixture = createFixture();
    const environment = companyMcpEnvironment(fixture);
    const { createIndexCompanyTool } = await loadMcpCompany();
    const close = vi.fn();
    const replaceSource = vi.fn();
    const tool = createIndexCompanyTool({
      environment,
      embeddingProvider: {
        getMetadata: () => ({ provider: "test", model: "deterministic" }),
        embed: vi.fn(async () => [1, 0]),
      },
      createVectorStore: vi.fn(() => ({ replaceSource, close })),
      readPdf: vi.fn(async () => ({
        relativePath: fixture.pdfRelativePath,
        pageCount: 1,
        text: "Grounding standard.",
        pages: [{ page: 1, text: "Grounding standard." }],
        truncated: false,
      })),
    });

    const result = await tool.handler({
      relativePath: fixture.pdfRelativePath,
      standardId: "CS-ELEC-001",
      title: "Electrical Design Standard",
    });

    expect(result).toMatchObject({ indexedChunks: 1 });
    expect(replaceSource).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});

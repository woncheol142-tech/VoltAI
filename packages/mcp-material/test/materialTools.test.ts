import { existsSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  connectInMemoryMcp,
  createMaterialMcpFixture,
  loadMcpMaterial,
  materialMcpEnvironment,
  readToolText,
  type MaterialMcpFixture,
} from "./helpers/materialMcpHarness.js";

const fixtures: MaterialMcpFixture[] = [];

async function createFixture(): Promise<MaterialMcpFixture> {
  const fixture = await createMaterialMcpFixture();
  fixtures.push(fixture);
  return fixture;
}

const columnMap = {
  itemCode: "Item Code",
  name: "Name",
  manufacturer: "Manufacturer",
  model: "Model",
  category: "Category",
  specification: "Specification",
  unit: "Unit",
  unitPrice: "Unit Price",
  currency: "Currency",
};

describe("mcp-material protocol", () => {
  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.cleanup();
    }
    vi.unstubAllGlobals();
  });

  it("keeps material_placeholder and exposes index_material/search_material schemas", async () => {
    const fixture = await createFixture();
    const { createServer } = await loadMcpMaterial();
    const connection = await connectInMemoryMcp(
      createServer({ environment: materialMcpEnvironment(fixture) }),
    );

    try {
      const result = await connection.client.listTools();
      const indexTool = result.tools.find(
        (tool) => tool.name === "index_material",
      );
      const searchTool = result.tools.find(
        (tool) => tool.name === "search_material",
      );

      expect(result.tools.map((tool) => tool.name)).toContain(
        "material_placeholder",
      );
      expect(indexTool?.inputSchema.properties).toEqual(
        expect.objectContaining({
          relativePath: expect.any(Object),
          catalogId: expect.any(Object),
          sheetName: expect.any(Object),
          headerRow: expect.any(Object),
          columnMap: expect.any(Object),
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

  it("round-trips index and search typed results as MCP JSON text", async () => {
    const fixture = await createFixture();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { createServer } = await loadMcpMaterial();
    const connection = await connectInMemoryMcp(
      createServer({ environment: materialMcpEnvironment(fixture) }),
    );

    try {
      const indexResponse = await connection.client.callTool({
        name: "index_material",
        arguments: {
          relativePath: fixture.xlsxRelativePath,
          catalogId: "CAT-ELEC-001",
          sheetName: "Catalog",
          columnMap,
        },
      });
      const indexResult = JSON.parse(readToolText(indexResponse)) as {
        relativePath: string;
        catalogId: string;
        sheetName: string;
        indexedRows: number;
      };

      expect(indexResponse.isError).not.toBe(true);
      expect(indexResult).toEqual({
        relativePath: fixture.xlsxRelativePath,
        catalogId: "CAT-ELEC-001",
        sheetName: "Catalog",
        indexedRows: 2,
      });
      expect(existsSync(fixture.dbPath)).toBe(true);

      const searchResponse = await connection.client.callTool({
        name: "search_material",
        arguments: { query: "cable", topK: 1 },
      });
      const searchResult = JSON.parse(readToolText(searchResponse)) as {
        results: Array<Record<string, unknown>>;
      };

      expect(searchResponse.isError).not.toBe(true);
      expect(searchResult.results).toEqual([
        expect.objectContaining({
          chunkId:
            "materials:catalogs/electrical-materials.xlsx#sheet=Catalog#row=2",
          itemCode: "CB-001",
          name: "XLPE Cable",
          rowIndex: 2,
        }),
      ]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await connection.close();
      expect(connection.isClosed()).toBe(true);
    }
  }, 15_000);

  it("closes a tool-owned store after successful material indexing", async () => {
    const fixture = await createFixture();
    const { createIndexMaterialTool } = await loadMcpMaterial();
    const close = vi.fn();
    const replaceSource = vi.fn();
    const tool = createIndexMaterialTool({
      environment: materialMcpEnvironment(fixture),
      embeddingProvider: {
        getMetadata: () => ({ provider: "test", model: "deterministic" }),
        embed: vi.fn(async () => [1, 0]),
      },
      createVectorStore: vi.fn(() => ({ replaceSource, close })),
      readMaterialSheet: vi.fn(async () => ({
        relativePath: fixture.xlsxRelativePath,
        sheetName: "Catalog",
        rows: [
          { rowIndex: 1, values: ["Item Code", "Name"] },
          { rowIndex: 2, values: ["CB-001", "XLPE Cable"] },
        ],
      })),
    });

    const result = await tool.handler({
      relativePath: fixture.xlsxRelativePath,
      catalogId: "CAT-ELEC-001",
      columnMap: { itemCode: "Item Code", name: "Name" },
    });

    expect(result).toMatchObject({ indexedRows: 1 });
    expect(replaceSource).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});

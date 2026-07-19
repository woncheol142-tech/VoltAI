import { rmSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { VoltAiTool } from "@voltai/mcp-core";
import { afterEach, describe, expect, it } from "vitest";

import type { DrawingSpatialRelationDocument } from "../src/drawingSpatial/types.js";
import { createServer } from "../src/index.js";
import { createTempPdfProject } from "./helpers/pdfFixture.js";
import { writeDrawingPrimitiveFixture } from "./helpers/drawingPrimitiveFixture.js";

const roots: string[] = [];

async function connectServer() {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "drawing-spatial-client",
    version: "0.1.0",
  });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server };
}

function responseText(response: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = response.content[0];
  expect(content).toMatchObject({ type: "text" });
  return (content as { type: "text"; text: string }).text;
}

describe("extract_drawing_spatial_relations MCP boundary", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exposes a typed handler returning a spatial relation document", async () => {
    const module = (await import(
      "../src/tools/extractDrawingSpatialRelations.js"
    )) as {
      createExtractDrawingSpatialRelationsTool: () => VoltAiTool<
        DrawingSpatialRelationDocument & { relativeSpatialPath?: string }
      >;
    };
    const root = createTempPdfProject();
    roots.push(root);
    writeDrawingPrimitiveFixture(root);
    const original = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;
    try {
      const result =
        await module.createExtractDrawingSpatialRelationsTool().handler({
          relativePath: "docs/drawing-primitives.pdf",
          page: 1,
        });
      expect(typeof result).toBe("object");
      expect(result).toMatchObject({
        schemaVersion: 1,
        page: 1,
        relationCount: expect.any(Number),
      });
    } finally {
      if (original === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = original;
    }
  });

  it("registers the exact schema without removing existing tools", async () => {
    const { client, server } = await connectServer();
    try {
      const tools = await client.listTools();
      const spatial = tools.tools.find(
        ({ name }) => name === "extract_drawing_spatial_relations",
      );

      expect(tools.tools.map(({ name }) => name)).toEqual(
        expect.arrayContaining([
          "extract_drawing_layout",
          "extract_drawing_primitives",
          "extract_drawing_classification",
          "extract_drawing_spatial_relations",
        ]),
      );
      expect(spatial?.inputSchema.required).toEqual(["relativePath", "page"]);
      expect(Object.keys(spatial?.inputSchema.properties ?? {}).sort()).toEqual([
        "outputName",
        "page",
        "relativePath",
      ]);
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });

  it("round-trips typed output through the boundary as JSON text", async () => {
    const root = createTempPdfProject();
    roots.push(root);
    writeDrawingPrimitiveFixture(root);
    const original = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;
    const { client, server } = await connectServer();
    try {
      const response = await client.callTool({
        name: "extract_drawing_spatial_relations",
        arguments: {
          relativePath: "docs/drawing-primitives.pdf",
          page: 1,
        },
      });
      const parsed = JSON.parse(
        responseText(response),
      ) as DrawingSpatialRelationDocument;

      expect(response.isError).not.toBe(true);
      expect(parsed).toMatchObject({
        schemaVersion: 1,
        source: "docs/drawing-primitives.pdf",
        page: 1,
        relations: expect.any(Array),
      });
      expect(parsed).not.toHaveProperty("primitives");
      expect(parsed).not.toHaveProperty("classifications");
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
      if (original === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = original;
    }
  });

  it("maps invalid input through the existing MCP error policy", async () => {
    const { client, server } = await connectServer();
    try {
      const response = await client.callTool({
        name: "extract_drawing_spatial_relations",
        arguments: { relativePath: "docs/spatial.pdf", page: 0 },
      });

      expect(response.isError).toBe(true);
      expect(responseText(response)).toContain("page");
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });
});


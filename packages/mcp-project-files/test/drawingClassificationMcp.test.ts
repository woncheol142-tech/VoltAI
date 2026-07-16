import { rmSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { VoltAiTool } from "@voltai/mcp-core";
import { afterEach, describe, expect, it } from "vitest";

import type { DrawingPrimitiveClassificationDocument } from "../src/drawingClassification/types.js";
import { createServer } from "../src/index.js";
import { createTempPdfProject } from "./helpers/pdfFixture.js";
import { writeDrawingPrimitiveFixture } from "./helpers/drawingPrimitiveFixture.js";

const roots: string[] = [];

async function connectServer() {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "drawing-classification-client",
    version: "0.1.0",
  });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

function responseText(response: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = response.content[0];
  expect(content).toMatchObject({ type: "text" });
  return (content as { type: "text"; text: string }).text;
}

describe("extract_drawing_classification MCP boundary", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exposes a typed handler returning the classification document", async () => {
    const module = (await import(
      "../src/tools/extractDrawingClassification.js"
    )) as {
      createExtractDrawingClassificationTool: () => VoltAiTool<DrawingPrimitiveClassificationDocument>;
    };
    const root = createTempPdfProject();
    roots.push(root);
    writeDrawingPrimitiveFixture(root);
    const original = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;
    try {
      const result = await module.createExtractDrawingClassificationTool().handler({
        relativePath: "docs/drawing-primitives.pdf",
        page: 1,
      });
      expect(typeof result).toBe("object");
      expect(result).toMatchObject({ schemaVersion: 1, page: 1 });
    } finally {
      if (original === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = original;
    }
  });

  it("registers the exact input schema without removing existing tools", async () => {
    const { client, server } = await connectServer();
    try {
      const tools = await client.listTools();
      const classification = tools.tools.find(
        ({ name }) => name === "extract_drawing_classification",
      );

      expect(tools.tools.map(({ name }) => name)).toEqual(
        expect.arrayContaining([
          "read_pdf",
          "render_pdf_page",
          "index_drawing_list",
          "search_drawings",
          "map_drawing_pages",
          "extract_drawing_layout",
          "extract_drawing_primitives",
          "extract_drawing_classification",
        ]),
      );
      expect(classification?.inputSchema.required).toEqual([
        "relativePath",
        "page",
      ]);
      expect(
        Object.keys(classification?.inputSchema.properties ?? {}).sort(),
      ).toEqual(["outputName", "page", "relativePath"]);
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });

  it("round-trips typed output as JSON text and keeps empty pages non-errors", async () => {
    const root = createTempPdfProject();
    roots.push(root);
    writeDrawingPrimitiveFixture(root);
    const original = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;
    const { client, server } = await connectServer();
    try {
      const response = await client.callTool({
        name: "extract_drawing_classification",
        arguments: {
          relativePath: "docs/drawing-primitives.pdf",
          page: 10,
        },
      });
      const parsed = JSON.parse(
        responseText(response),
      ) as DrawingPrimitiveClassificationDocument;

      expect(response.isError).not.toBe(true);
      expect(parsed).toMatchObject({
        primitiveCount: 0,
        classificationCount: 0,
        classifications: [],
      });
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
      if (original === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = original;
    }
  });

  it("maps invalid input to the existing MCP error policy", async () => {
    const { client, server } = await connectServer();
    try {
      const response = await client.callTool({
        name: "extract_drawing_classification",
        arguments: { relativePath: "docs/primitives.pdf", page: 0 },
      });

      expect(response.isError).toBe(true);
      expect(responseText(response)).toContain("page");
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });
});

import { rmSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { VoltAiTool } from "@voltai/mcp-core";
import { afterEach, describe, expect, it } from "vitest";

import { createServer } from "../src/index.js";
import { createTempPdfProject } from "./helpers/pdfFixture.js";
import { writeDrawingLayoutFixture } from "./helpers/drawingLayoutFixture.js";

type LayoutResult = {
  schemaVersion: 1;
  page: number;
  itemCount: number;
  lineCount: number;
  items: unknown[];
  lines: unknown[];
  warnings: string[];
};

const modulePath = "../src/tools/extractDrawingLayout.js";
const roots: string[] = [];

async function loadToolFactory(): Promise<() => VoltAiTool<LayoutResult>> {
  const module = (await import(modulePath)) as {
    createExtractDrawingLayoutTool: () => VoltAiTool<LayoutResult>;
  };
  return module.createExtractDrawingLayoutTool;
}

async function connectServer() {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "drawing-layout-client", version: "0.1.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

function tempRoot(): string {
  const root = createTempPdfProject();
  roots.push(root);
  writeDrawingLayoutFixture(root);
  return root;
}

function responseText(response: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = response.content[0];
  expect(content).toMatchObject({ type: "text" });
  return (content as { type: "text"; text: string }).text;
}

describe("extract_drawing_layout MCP boundary", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("uses a typed object handler result", async () => {
    const root = tempRoot();
    const original = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;

    try {
      const createTool = await loadToolFactory();
      const result = await createTool().handler({
        relativePath: "docs/drawing-layout.pdf",
        page: 1,
      });

      expect(typeof result).toBe("object");
      expect(result).toMatchObject({ schemaVersion: 1, page: 1 });
    } finally {
      if (original === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = original;
    }
  });

  it("lists the exact fixed input contract and preserves Task 39-42 tools", async () => {
    const { client, server } = await connectServer();

    try {
      const tools = await client.listTools();
      const layout = tools.tools.find(({ name }) => name === "extract_drawing_layout");

      expect(tools.tools.map(({ name }) => name)).toEqual(
        expect.arrayContaining([
          "read_pdf",
          "render_pdf_page",
          "index_drawing_list",
          "search_drawings",
          "map_drawing_pages",
          "extract_drawing_layout",
        ]),
      );
      expect(layout?.inputSchema.required).toEqual(["relativePath", "page"]);
      expect(Object.keys(layout?.inputSchema.properties ?? {}).sort()).toEqual([
        "outputName",
        "page",
        "relativePath",
      ]);
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });

  it("round-trips the typed result as JSON text", async () => {
    const root = tempRoot();
    const original = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;
    const { client, server } = await connectServer();

    try {
      const response = await client.callTool({
        name: "extract_drawing_layout",
        arguments: { relativePath: "docs/drawing-layout.pdf", page: 1 },
      });
      const parsed = JSON.parse(responseText(response)) as LayoutResult;

      expect(response.isError).not.toBe(true);
      expect(parsed).toMatchObject({ schemaVersion: 1, page: 1 });
      expect(parsed.itemCount).toBe(parsed.items.length);
      expect(parsed.lineCount).toBe(parsed.lines.length);
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
      if (original === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = original;
    }
  });

  it.each([
    [{ relativePath: "docs/drawing-layout.pdf" }, "page"],
    [{ relativePath: "docs/drawing-layout.pdf", page: 0 }, "page"],
    [{ relativePath: "../drawing-layout.pdf", page: 1 }, "relativePath"],
  ])("maps invalid input to the existing MCP error policy", async (arguments_, field) => {
    const { client, server } = await connectServer();

    try {
      const response = await client.callTool({
        name: "extract_drawing_layout",
        arguments: arguments_,
      });

      expect(response.isError).toBe(true);
      expect(responseText(response)).toContain(field);
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });

  it("returns a vector-only zero-item layout with isError=false", async () => {
    const root = tempRoot();
    const original = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;
    const { client, server } = await connectServer();

    try {
      const response = await client.callTool({
        name: "extract_drawing_layout",
        arguments: { relativePath: "docs/drawing-layout.pdf", page: 8 },
      });
      const parsed = JSON.parse(responseText(response)) as LayoutResult;

      expect(response.isError).not.toBe(true);
      expect(parsed).toMatchObject({ itemCount: 0, lineCount: 0, items: [], lines: [] });
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
      if (original === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = original;
    }
  });
});

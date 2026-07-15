import { rmSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { createServer } from "../src/index.js";
import { writeDrawingListFixture } from "./helpers/drawingListFixture.js";
import { createTempPdfProject } from "./helpers/pdfFixture.js";

type IndexDrawingListResult = {
  schemaVersion: 1;
  source: string;
  drawingCount: number;
  drawings: unknown[];
  warnings: string[];
};

type IndexDrawingListTool = {
  name: string;
  handler(input: unknown): Promise<IndexDrawingListResult>;
};

const toolModulePath = "../src/tools/indexDrawingList.js";
const tempRoots: string[] = [];

async function loadToolFactory(): Promise<() => IndexDrawingListTool> {
  const module = (await import(toolModulePath)) as {
    createIndexDrawingListTool: () => IndexDrawingListTool;
  };
  return module.createIndexDrawingListTool;
}

async function connectServer() {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "drawing-index-test-client", version: "0.1.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

function createTempProject(): string {
  const root = createTempPdfProject();
  tempRoots.push(root);
  return root;
}

describe("index_drawing_list MCP contract", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exposes index_drawing_list and its complete input schema through listTools", async () => {
    const { client, server } = await connectServer();

    try {
      const tools = await client.listTools();
      const tool = tools.tools.find((candidate) => candidate.name === "index_drawing_list");

      expect(tool?.inputSchema.required).toEqual([
        "relativePath",
        "startPage",
        "endPage",
      ]);
      expect(tool?.inputSchema.properties).toMatchObject({
        relativePath: expect.any(Object),
        startPage: expect.any(Object),
        endPage: expect.any(Object),
        outputName: expect.any(Object),
      });
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });

  it("returns a typed result object from the production tool handler", async () => {
    const root = createTempProject();
    writeDrawingListFixture(root);
    const originalProjectRoot = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;

    try {
      const createTool = await loadToolFactory();
      const tool = createTool();
      const result = await tool.handler({
        relativePath: "docs/drawing-list.pdf",
        startPage: 1,
        endPage: 2,
      });

      expect(tool.name).toBe("index_drawing_list");
      expect(typeof result).not.toBe("string");
      expect(result).toMatchObject({
        schemaVersion: 1,
        source: "docs/drawing-list.pdf",
        drawingCount: 6,
      });
    } finally {
      if (originalProjectRoot === undefined) {
        delete process.env.PROJECT_ROOT;
      } else {
        process.env.PROJECT_ROOT = originalProjectRoot;
      }
    }
  });

  it("serializes the typed result as JSON text across the MCP protocol", async () => {
    const root = createTempProject();
    writeDrawingListFixture(root);
    const originalProjectRoot = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;
    const { client, server } = await connectServer();

    try {
      const result = await client.callTool({
        name: "index_drawing_list",
        arguments: {
          relativePath: "docs/drawing-list.pdf",
          startPage: 1,
          endPage: 2,
        },
      });
      const content = result.content[0];

      expect(content.type).toBe("text");
      expect(content).toHaveProperty("text");
      const parsed = JSON.parse((content as { type: "text"; text: string }).text) as IndexDrawingListResult;
      expect(parsed).toMatchObject({ schemaVersion: 1, drawingCount: 6 });
      expect(parsed.drawings.length).toBe(parsed.drawingCount);
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
      if (originalProjectRoot === undefined) {
        delete process.env.PROJECT_ROOT;
      } else {
        process.env.PROJECT_ROOT = originalProjectRoot;
      }
    }
  });

  it("maps invalid protocol input to an MCP error result", async () => {
    const { client, server } = await connectServer();

    try {
      const result = await client.callTool({
        name: "index_drawing_list",
        arguments: {
          relativePath: "docs/drawing-list.pdf",
          startPage: 0,
          endPage: 2,
        },
      });

      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("startPage");
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });
});

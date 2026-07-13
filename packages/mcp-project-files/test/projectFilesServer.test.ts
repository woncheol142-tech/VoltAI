import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createServer } from "../src/index.js";

describe("mcp-project-files server", () => {
  it("exposes render_pdf_page and its input contract through MCP listTools", async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "project-files-test-client", version: "0.1.0" });

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const tools = await client.listTools();
      const renderTool = tools.tools.find((tool) => tool.name === "render_pdf_page");

      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "list_project_files",
          "read_pdf",
          "read_excel",
          "render_pdf_page",
        ]),
      );
      expect(renderTool?.inputSchema.required).toEqual(
        expect.arrayContaining(["relativePath", "page"]),
      );
      expect(renderTool?.inputSchema.properties).toMatchObject({
        relativePath: expect.any(Object),
        page: expect.any(Object),
        scale: expect.any(Object),
        format: expect.any(Object),
      });
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });
});

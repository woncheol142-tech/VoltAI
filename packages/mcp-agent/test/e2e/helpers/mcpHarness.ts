import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type InMemoryMcpConnection = {
  client: Client;
  close: () => Promise<void>;
  isClosed: () => boolean;
};

export async function connectInMemoryMcp(server: McpServer): Promise<InMemoryMcpConnection> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "voltai-review-e2e-client",
    version: "0.1.0",
  });
  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }

    closed = true;
    await Promise.all([client.close(), server.close()]);
  };

  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  } catch (error) {
    await close();
    throw error;
  }

  return { client, close, isClosed: () => closed };
}

export async function callReviewProject(client: Client, projectPath?: string) {
  return client.callTool({
    name: "review_project",
    arguments: projectPath === undefined ? {} : { projectPath },
  });
}

import type { VoltAiTool } from "@voltai/mcp-core";

export const placeholderToolName = "estimate_placeholder";

export function createPlaceholderMessage(): string {
  return "mcp-estimate placeholder tool is ready.";
}

export const placeholderTool: VoltAiTool = {
  name: placeholderToolName,
  description: "Placeholder estimate tool.",
  inputSchema: {},
  handler: createPlaceholderMessage,
};

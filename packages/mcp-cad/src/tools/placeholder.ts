import type { VoltAiTool } from "@voltai/mcp-core";

export const placeholderToolName = "cad_placeholder";

export function createPlaceholderMessage(): string {
  return "mcp-cad placeholder tool is ready.";
}

export const placeholderTool: VoltAiTool<string> = {
  name: placeholderToolName,
  description: "Placeholder CAD tool.",
  inputSchema: {},
  handler: createPlaceholderMessage,
};

import type { VoltAiTool } from "@voltai/mcp-core";

export const placeholderToolName = "material_placeholder";

export function createPlaceholderMessage(): string {
  return "mcp-material placeholder tool is ready.";
}

export const placeholderTool: VoltAiTool<string> = {
  name: placeholderToolName,
  description: "Placeholder material tool.",
  inputSchema: {},
  handler: createPlaceholderMessage,
};

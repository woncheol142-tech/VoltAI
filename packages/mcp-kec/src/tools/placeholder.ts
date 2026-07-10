import type { VoltAiTool } from "@voltai/mcp-core";

export const placeholderToolName = "kec_placeholder";

export function createPlaceholderMessage(): string {
  return "mcp-kec placeholder tool is ready.";
}

export const placeholderTool: VoltAiTool<string> = {
  name: placeholderToolName,
  description: "Placeholder KEC tool.",
  inputSchema: {},
  handler: createPlaceholderMessage,
};

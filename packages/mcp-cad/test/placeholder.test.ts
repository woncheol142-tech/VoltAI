import { describe, expect, it } from "vitest";

import {
  createPlaceholderMessage,
  placeholderTool,
  placeholderToolName,
} from "../src/tools/placeholder.js";

describe("mcp-cad placeholder tool", () => {
  it("exposes a stable placeholder tool name and message", () => {
    expect(placeholderToolName).toBe("cad_placeholder");
    expect(createPlaceholderMessage()).toBe("mcp-cad placeholder tool is ready.");
    expect(placeholderTool.handler()).toBe("mcp-cad placeholder tool is ready.");
  });
});

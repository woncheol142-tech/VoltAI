import { describe, expect, it } from "vitest";

import {
  createPlaceholderMessage,
  placeholderTool,
  placeholderToolName,
} from "../src/tools/placeholder.js";

describe("mcp-kec placeholder tool", () => {
  it("exposes a stable placeholder tool name and message", () => {
    expect(placeholderToolName).toBe("kec_placeholder");
    expect(createPlaceholderMessage()).toBe("mcp-kec placeholder tool is ready.");
    expect(placeholderTool.handler()).toBe("mcp-kec placeholder tool is ready.");
  });
});

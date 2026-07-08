import { describe, expect, it } from "vitest";

import { createPlaceholderMessage, placeholderToolName } from "../src/tools/placeholder.js";

describe("mcp-estimate placeholder tool", () => {
  it("exposes a stable placeholder tool name and message", () => {
    expect(placeholderToolName).toBe("estimate_placeholder");
    expect(createPlaceholderMessage()).toBe("mcp-estimate placeholder tool is ready.");
  });
});

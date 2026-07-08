import { describe, expect, it } from "vitest";

import { createPlaceholderMessage, placeholderToolName } from "../src/tools/placeholder.js";

describe("mcp-material placeholder tool", () => {
  it("exposes a stable placeholder tool name and message", () => {
    expect(placeholderToolName).toBe("material_placeholder");
    expect(createPlaceholderMessage()).toBe("mcp-material placeholder tool is ready.");
  });
});

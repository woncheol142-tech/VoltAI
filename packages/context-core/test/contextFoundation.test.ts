import { describe, expect, it } from "vitest";

describe("context-core runtime surface", () => {
  it("exports no runtime values from the type-only foundation", async () => {
    const contextCore = await import("../src/index.js");

    expect(Object.keys(contextCore)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

describe("extraction-core runtime surface", () => {
  it("exports no runtime values from the type-only foundation", async () => {
    const extractionCore = await import("../src/index.js");

    expect(Object.keys(extractionCore)).toEqual([]);
  });
});

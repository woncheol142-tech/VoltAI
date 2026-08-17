import { describe, expect, it } from "vitest";

describe("source-core runtime surface", () => {
  it("exports no runtime values from the type-only foundation", async () => {
    const sourceCore = await import("../src/index.js");

    expect(Object.keys(sourceCore)).toEqual([]);
  });
});

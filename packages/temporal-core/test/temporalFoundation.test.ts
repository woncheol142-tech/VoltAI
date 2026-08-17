import { describe, expect, it } from "vitest";

describe("temporal-core runtime surface", () => {
  it("exports no runtime values from the type-only foundation", async () => {
    const temporalCore = await import("../src/index.js");

    expect(Object.keys(temporalCore)).toEqual([]);
  });
});

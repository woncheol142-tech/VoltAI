import { describe, expect, it } from "vitest";

describe("promotion-core runtime surface", () => {
  it("exports no runtime values from the type-only foundation", async () => {
    const promotionCore = await import("../src/index.js");

    expect(Object.keys(promotionCore)).toEqual([]);
  });
});

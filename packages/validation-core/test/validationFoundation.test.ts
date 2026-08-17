import { describe, expect, it } from "vitest";

describe("validation-core runtime surface", () => {
  it("exports no runtime values from the type-only foundation", async () => {
    const validationCore = await import("../src/index.js");

    expect(Object.keys(validationCore)).toEqual([]);
  });
});

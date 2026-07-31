import { describe, expect, it } from "vitest";

describe("drawing spatial package exports", () => {
  it("exports the builder, writer, extractor, and tool factory from the package root", async () => {
    const projectFiles = await import("../src/index.js");

    expect(projectFiles).toMatchObject({
      buildDrawingSpatialRelations: expect.any(Function),
      writeDrawingSpatialRelations: expect.any(Function),
      extractDrawingSpatialRelations: expect.any(Function),
      createExtractDrawingSpatialRelationsTool: expect.any(Function),
    });
  }, 15_000);
});

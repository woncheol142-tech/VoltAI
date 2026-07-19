import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDrawingSpatialFixture,
} from "./helpers/drawingSpatialFixture.js";
import { createTempPdfProject } from "./helpers/pdfFixture.js";

const mocks = vi.hoisted(() => ({
  layout: vi.fn(),
  primitive: vi.fn(),
  write: vi.fn(),
}));

vi.mock("../src/tools/extractDrawingLayout.js", () => ({
  extractDrawingLayout: mocks.layout,
}));
vi.mock("../src/tools/extractDrawingPrimitives.js", () => ({
  extractDrawingPrimitives: mocks.primitive,
}));
vi.mock("../src/drawingSpatial/writeDrawingSpatialRelations.js", () => ({
  writeDrawingSpatialRelations: mocks.write,
}));

const roots: string[] = [];

describe("extractDrawingSpatialRelations composition and lifecycle", () => {
  afterEach(() => {
    mocks.layout.mockReset();
    mocks.primitive.mockReset();
    mocks.write.mockReset();
    vi.resetModules();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses typed layout and primitive extractors exactly once", async () => {
    const root = createTempPdfProject();
    roots.push(root);
    const fixture = createDrawingSpatialFixture();
    mocks.layout.mockResolvedValue(fixture.layout);
    mocks.primitive.mockResolvedValue(fixture.primitive);
    const { extractDrawingSpatialRelations } = await import(
      "../src/tools/extractDrawingSpatialRelations.js"
    );

    const result = await extractDrawingSpatialRelations(root, {
      relativePath: "docs/spatial.pdf",
      page: 15,
    });

    expect(result).toMatchObject({ schemaVersion: 1, page: 15 });
    expect(mocks.layout).toHaveBeenCalledTimes(1);
    expect(mocks.primitive).toHaveBeenCalledTimes(1);
    expect(mocks.layout).toHaveBeenCalledWith(root, {
      relativePath: "docs/spatial.pdf",
      page: 15,
    });
    expect(mocks.primitive).toHaveBeenCalledWith(root, {
      relativePath: "docs/spatial.pdf",
      page: 15,
    });
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("never calls the classification extraction tool or reparses MCP JSON", async () => {
    const fixture = createDrawingSpatialFixture();
    mocks.layout.mockResolvedValue(fixture.layout);
    mocks.primitive.mockResolvedValue(fixture.primitive);
    const source = await import("../src/tools/extractDrawingSpatialRelations.js");

    await source.extractDrawingSpatialRelations(createTempPdfProject(), {
      relativePath: "docs/spatial.pdf",
      page: 15,
    });

    expect(mocks.layout).toHaveBeenCalledOnce();
    expect(mocks.primitive).toHaveBeenCalledOnce();
  });

  it("propagates first-pass failure without running the second pass", async () => {
    mocks.layout.mockRejectedValue(new Error("layout failed"));
    const { extractDrawingSpatialRelations } = await import(
      "../src/tools/extractDrawingSpatialRelations.js"
    );

    await expect(
      extractDrawingSpatialRelations(createTempPdfProject(), {
        relativePath: "docs/spatial.pdf",
        page: 15,
      }),
    ).rejects.toThrow("layout failed");
    expect(mocks.primitive).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("propagates second-pass failure without persistence", async () => {
    const fixture = createDrawingSpatialFixture();
    mocks.layout.mockResolvedValue(fixture.layout);
    mocks.primitive.mockRejectedValue(new Error("primitive failed"));
    const { extractDrawingSpatialRelations } = await import(
      "../src/tools/extractDrawingSpatialRelations.js"
    );

    await expect(
      extractDrawingSpatialRelations(createTempPdfProject(), {
        relativePath: "docs/spatial.pdf",
        page: 15,
        outputName: "spatial",
      }),
    ).rejects.toThrow("primitive failed");
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("fails closed when the source changes between extraction passes", async () => {
    const fixture = createDrawingSpatialFixture();
    fixture.primitive.sourceSha256 = "9".repeat(64);
    mocks.layout.mockResolvedValue(fixture.layout);
    mocks.primitive.mockResolvedValue(fixture.primitive);
    const { extractDrawingSpatialRelations } = await import(
      "../src/tools/extractDrawingSpatialRelations.js"
    );

    await expect(
      extractDrawingSpatialRelations(createTempPdfProject(), {
        relativePath: "docs/spatial.pdf",
        page: 15,
      }),
    ).rejects.toThrow(/sha|source.*changed|mismatch/i);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("returns the writer path only from the tool wrapper", async () => {
    const root = createTempPdfProject();
    roots.push(root);
    const fixture = createDrawingSpatialFixture();
    mocks.layout.mockResolvedValue(fixture.layout);
    mocks.primitive.mockResolvedValue(fixture.primitive);
    mocks.write.mockReturnValue(
      ".volt-ai/spatial/spatial-123456789abc-page-015.json",
    );
    const { extractDrawingSpatialRelations } = await import(
      "../src/tools/extractDrawingSpatialRelations.js"
    );

    const result = await extractDrawingSpatialRelations(root, {
      relativePath: "docs/spatial.pdf",
      page: 15,
      outputName: "spatial",
    });

    expect(result.relativeSpatialPath).toBe(
      ".volt-ai/spatial/spatial-123456789abc-page-015.json",
    );
    expect(mocks.write).toHaveBeenCalledOnce();
    const persistedDocument = mocks.write.mock.calls[0]?.[1];
    expect(persistedDocument).not.toHaveProperty("relativeSpatialPath");
    expect(existsSync(join(root, ".volt-ai"))).toBe(false);
  });

  it("propagates persistence failure without returning a partial result", async () => {
    const fixture = createDrawingSpatialFixture();
    mocks.layout.mockResolvedValue(fixture.layout);
    mocks.primitive.mockResolvedValue(fixture.primitive);
    mocks.write.mockImplementation(() => {
      throw new Error("persistence failed");
    });
    const { extractDrawingSpatialRelations } = await import(
      "../src/tools/extractDrawingSpatialRelations.js"
    );

    await expect(
      extractDrawingSpatialRelations(createTempPdfProject(), {
        relativePath: "docs/spatial.pdf",
        page: 15,
        outputName: "spatial",
      }),
    ).rejects.toThrow("persistence failed");
  });
});


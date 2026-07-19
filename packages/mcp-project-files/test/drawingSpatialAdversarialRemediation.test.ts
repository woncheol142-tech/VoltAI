import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { buildDrawingSpatialRelations } from "../src/drawingSpatial/buildDrawingSpatialRelations.js";
import { createSpatialHashGrid } from "../src/drawingSpatial/spatialHashGrid.js";
import { writeDrawingSpatialRelations } from "../src/drawingSpatial/writeDrawingSpatialRelations.js";
import type { PageBBox } from "../src/drawingPrimitive/types.js";
import {
  makeSpatialClassificationDocument,
  makeSpatialLayout,
  makeSpatialPrimitive,
  makeSpatialPrimitiveDocument,
  makeSpatialTextItem,
} from "./helpers/drawingSpatialFixture.js";
import { createTempPdfProject } from "./helpers/pdfFixture.js";

const roots: string[] = [];
const readmePath = fileURLToPath(new URL("../README.md", import.meta.url));

function tempRoot(): string {
  const root = createTempPdfProject();
  roots.push(root);
  return root;
}

function buildBoundaryDocument(primitiveBBoxes: PageBBox[]) {
  const item = makeSpatialTextItem({
    id: "item",
    sourceOrder: 0,
    pageBBox: { x: 0, y: 0, width: 10, height: 10 },
  });
  const primitives = primitiveBBoxes.map((pageBBox, sourceOrder) =>
    makeSpatialPrimitive({
      id: `primitive-${sourceOrder}`,
      sourceOrder,
      pageBBox,
    })
  );
  return buildDrawingSpatialRelations({
    layout: makeSpatialLayout({ items: [item] }),
    primitive: makeSpatialPrimitiveDocument(primitives),
    classification: makeSpatialClassificationDocument(
      primitives,
      primitives.map(() => "line"),
    ),
  });
}

function relationTypesByPrimitive(
  document: ReturnType<typeof buildBoundaryDocument>,
): Map<string, string[]> {
  return new Map(
    document.relations.map((relation) => [
      relation.primitiveId,
      relation.relationTypes,
    ]),
  );
}

function documentForSource(source: string) {
  const item = makeSpatialTextItem({
    id: "item",
    sourceOrder: 0,
    pageBBox: { x: 0, y: 0, width: 1, height: 1 },
  });
  const primitive = makeSpatialPrimitive({
    id: "primitive",
    sourceOrder: 0,
    pageBBox: { x: 0, y: 0, width: 1, height: 1 },
  });
  const layout = makeSpatialLayout({ items: [item] });
  const primitiveDocument = makeSpatialPrimitiveDocument([primitive]);
  const classification = makeSpatialClassificationDocument(
    [primitive],
    ["line"],
  );
  layout.source = source;
  primitiveDocument.source = source;
  classification.source = source;
  return buildDrawingSpatialRelations({
    layout,
    primitive: primitiveDocument,
    classification,
  });
}

describe("drawing spatial adversarial remediation", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses raw edge distance for the adjacent 2pt boundary", () => {
    const result = buildBoundaryDocument([
      { x: 11.9995, y: 4, width: 1, height: 1 },
      { x: 12, y: 4, width: 1, height: 1 },
      { x: 12.0004, y: 4, width: 1, height: 1 },
    ]);
    const types = relationTypesByPrimitive(result);

    expect(types.get("primitive-0")).toContain("adjacent");
    expect(types.get("primitive-1")).toContain("adjacent");
    expect(types.get("primitive-2")).not.toContain("adjacent");
    expect(
      result.relations.every(
        ({ distancePt }) => Number(distancePt.toFixed(3)) === distancePt,
      ),
    ).toBe(true);
  });

  it("uses raw horizontal distance for the nearest 8pt boundary", () => {
    const result = buildBoundaryDocument([
      { x: 17.9995, y: 4, width: 1, height: 1 },
      { x: 18, y: 4, width: 1, height: 1 },
      { x: 18.0004, y: 4, width: 1, height: 1 },
    ]);
    const types = relationTypesByPrimitive(result);

    expect(types.get("primitive-0")).toContain("nearest");
    expect(types.get("primitive-1")).toContain("nearest");
    expect(types.has("primitive-2")).toBe(false);
  });

  it("uses raw diagonal distance for the nearest 8pt boundary", () => {
    const distances = [7.9995, 8, 8.0004];
    const result = buildBoundaryDocument(
      distances.map((distance) => {
        const gap = distance / Math.SQRT2;
        return { x: 10 + gap, y: 10 + gap, width: 1, height: 1 };
      }),
    );
    const types = relationTypesByPrimitive(result);

    expect(types.get("primitive-0")).toContain("nearest");
    expect(types.get("primitive-1")).toContain("nearest");
    expect(types.has("primitive-2")).toBe(false);
  });

  it("uses raw center deltas for the aligned 1pt boundary", () => {
    const result = buildBoundaryDocument(
      [0.9995, 1, 1.0004].map((delta) => ({
        x: 14,
        y: 4.5 + delta,
        width: 1,
        height: 1,
      })),
    );
    const types = relationTypesByPrimitive(result);

    expect(types.get("primitive-0")).toContain("aligned");
    expect(types.get("primitive-1")).toContain("aligned");
    expect(types.get("primitive-2")).not.toContain("aligned");
    expect(
      result.relations.map(({ geometry }) => geometry.centerDeltaYPt),
    ).toEqual([1, 1, 1]);
  });

  it("keeps compatibility-distinct source paths as distinct identities", () => {
    const root = tempRoot();
    const ascii = documentForSource("docs/A.pdf");
    const fullWidth = documentForSource("docs/Ａ.pdf");

    const asciiPath = writeDrawingSpatialRelations(root, ascii, "spatial");
    const fullWidthPath = writeDrawingSpatialRelations(
      root,
      fullWidth,
      "spatial",
    );

    expect(fullWidthPath).not.toBe(asciiPath);
    expect(writeDrawingSpatialRelations(root, ascii, "spatial")).toBe(
      asciiPath,
    );
    expect(readFileSync(join(root, asciiPath), "utf8")).toContain(
      '"source":"docs/A.pdf"',
    );
    expect(readFileSync(join(root, fullWidthPath), "utf8")).toContain(
      '"source":"docs/Ａ.pdf"',
    );
  });

  it.each([1_000_000_000, -1_000_000_000])(
    "indexes finite extreme primitive coordinate %d through overflow",
    (x) => {
      const primitive = makeSpatialPrimitive({
        id: "extreme",
        sourceOrder: 0,
        pageBBox: { x, y: 0, width: 1, height: 1 },
      });
      const grid = createSpatialHashGrid([primitive]);

      expect(grid.diagnostics.overflowPrimitiveCount).toBe(1);
      expect(grid.query({ x, y: 0, width: 1, height: 1 }, 0)).toEqual([0]);
    },
  );

  it("uses a bounded all-primitive fallback for an oversized query", () => {
    const primitives = [
      makeSpatialPrimitive({
        id: "normal",
        sourceOrder: 0,
        pageBBox: { x: 0, y: 0, width: 1, height: 1 },
      }),
      makeSpatialPrimitive({
        id: "extreme",
        sourceOrder: 1,
        pageBBox: { x: 1_000_000_000, y: 0, width: 1, height: 1 },
      }),
    ];
    const grid = createSpatialHashGrid(primitives);
    const candidates = grid.query(
      { x: -1_000_000_000, y: 0, width: 2_000_000_001, height: 1 },
      8,
    );

    expect(candidates).toEqual([0, 1]);
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it("keeps extreme-coordinate narrow-phase relations correct", () => {
    const item = makeSpatialTextItem({
      id: "item",
      sourceOrder: 0,
      pageBBox: { x: 1_000_000_000, y: 0, width: 10, height: 10 },
    });
    const primitives = [
      makeSpatialPrimitive({
        id: "overlap",
        sourceOrder: 0,
        pageBBox: { x: 1_000_000_001, y: 1, width: 1, height: 1 },
      }),
      makeSpatialPrimitive({
        id: "far",
        sourceOrder: 1,
        pageBBox: { x: -1_000_000_000, y: 0, width: 1, height: 1 },
      }),
    ];
    const result = buildDrawingSpatialRelations({
      layout: makeSpatialLayout({ items: [item] }),
      primitive: makeSpatialPrimitiveDocument(primitives),
      classification: makeSpatialClassificationDocument(
        primitives,
        ["line", "line"],
      ),
    });

    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]).toMatchObject({
      primitiveId: "overlap",
      relationTypes: ["inside", "intersects"],
    });
  });

  it("documents primitive-to-text direction without inverse rows", () => {
    const section =
      readFileSync(readmePath, "utf8").split(
        "extract_drawing_spatial_relations",
      )[1] ?? "";

    const normalized = section.replace(/\s+/gu, " ");
    expect(normalized).toMatch(/primitive to the text entity/i);
    expect(normalized).toMatch(/text items.*text lines.*independent/i);
    expect(normalized).toMatch(/inverse relation rows are not duplicated/i);
  });
});

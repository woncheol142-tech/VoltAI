import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { buildDrawingSpatialRelations } from "../src/drawingSpatial/buildDrawingSpatialRelations.js";
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

function tempRoot(): string {
  const root = createTempPdfProject();
  roots.push(root);
  return root;
}

function buildFixture(options: {
  textBBox?: PageBBox;
  primitives: Array<{ id: string; pageBBox: PageBBox }>;
  source?: string;
}) {
  const item = makeSpatialTextItem({
    id: "item",
    sourceOrder: 0,
    pageBBox: options.textBBox ?? { x: 0, y: 0, width: 10, height: 10 },
  });
  const primitives = options.primitives.map(({ id, pageBBox }, sourceOrder) =>
    makeSpatialPrimitive({ id, sourceOrder, pageBBox })
  );
  const layout = makeSpatialLayout({ items: [item] });
  const primitive = makeSpatialPrimitiveDocument(primitives);
  const classification = makeSpatialClassificationDocument(
    primitives,
    primitives.map(() => "line"),
  );
  if (options.source !== undefined) {
    layout.source = options.source;
    primitive.source = options.source;
    classification.source = options.source;
  }
  return { layout, primitive, classification };
}

function documentForSource(source: string) {
  return buildDrawingSpatialRelations(
    buildFixture({
      source,
      primitives: [
        { id: "primitive", pageBBox: { x: 0, y: 0, width: 1, height: 1 } },
      ],
    }),
  );
}

describe("drawing spatial Step 4B remediation", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("canonicalizes repeated slash source aliases to one persistence path", () => {
    const root = tempRoot();
    const paths = ["docs/A.pdf", "docs//A.pdf", "docs///A.pdf"].map(
      (source) =>
        writeDrawingSpatialRelations(
          root,
          documentForSource(source),
          "spatial",
        ),
    );

    expect(new Set(paths).size).toBe(1);
  });

  it("canonicalizes backslash source aliases to the same persistence path", () => {
    const root = tempRoot();
    const paths = ["docs/A.pdf", "docs\\A.pdf", "docs\\\\A.pdf"].map(
      (source) =>
        writeDrawingSpatialRelations(
          root,
          documentForSource(source),
          "spatial",
        ),
    );

    expect(new Set(paths).size).toBe(1);
  });

  it("preserves distinct Unicode source identities without normalization", () => {
    const root = tempRoot();
    const sources = [
      "docs/A.pdf",
      "docs/Ａ.pdf",
      "docs/Å.pdf",
      "docs/Å.pdf",
      "docs/é.pdf",
      "docs/é.pdf",
    ];
    const paths = sources.map((source) =>
      writeDrawingSpatialRelations(
        root,
        documentForSource(source),
        "spatial",
      )
    );

    expect(new Set(paths).size).toBe(sources.length);
    expect(
      writeDrawingSpatialRelations(
        root,
        documentForSource(sources[0]!),
        "spatial",
      ),
    ).toBe(paths[0]);
  });

  it("uses the same persistence path for an identical source on every run", () => {
    const root = tempRoot();
    const document = documentForSource("docs/repeated.pdf");

    expect(writeDrawingSpatialRelations(root, document, "spatial")).toBe(
      writeDrawingSpatialRelations(root, structuredClone(document), "spatial"),
    );
  });

  it.each([Number.MAX_VALUE, -Number.MAX_VALUE])(
    "excludes a clearly distant finite extreme primitive at x=%s without failing",
    (x) => {
      const result = buildDrawingSpatialRelations(
        buildFixture({
          primitives: [
            {
              id: "extreme",
              pageBBox: {
                x,
                y: 0,
                width: x > 0 ? Number.MAX_VALUE : 1,
                height: 1,
              },
            },
          ],
        }),
      );

      expect(result.relations).toEqual([]);
      expect(result.warnings).not.toContainEqual(
        expect.stringContaining("UNREPRESENTABLE_GEOMETRY_PAIR"),
      );
    },
  );

  it("keeps identical extreme points as deterministic finite topology", () => {
    const bbox = { x: Number.MAX_VALUE, y: Number.MAX_VALUE, width: 0, height: 0 };
    const fixture = buildFixture({ textBBox: bbox, primitives: [{ id: "point", pageBBox: bbox }] });
    const first = buildDrawingSpatialRelations(fixture);
    const second = buildDrawingSpatialRelations(structuredClone(fixture));

    expect(first).toEqual(second);
    expect(first.relations).toHaveLength(1);
    expect(first.relations[0]).toMatchObject({
      relationTypes: ["intersects", "overlaps"],
      distancePt: 0,
      geometry: {
        topology: "overlaps",
        centerDeltaXPt: 0,
        centerDeltaYPt: 0,
        intersectionAreaPt2: 0,
      },
    });
  });

  it("builds identical extreme small bboxes without public non-finite values", () => {
    const bbox = { x: Number.MAX_VALUE, y: 0, width: 1, height: 1 };
    const result = buildDrawingSpatialRelations(
      buildFixture({ textBBox: bbox, primitives: [{ id: "small", pageBBox: bbox }] }),
    );
    const json = JSON.stringify(result);

    expect(result.relations).toHaveLength(1);
    expect(json).not.toMatch(/NaN|Infinity/u);
    expect(JSON.parse(json)).toEqual(result);
  });

  it("excludes an unrepresentable enormous pair with a deterministic warning", () => {
    const bbox = {
      x: 0,
      y: 0,
      width: Number.MAX_VALUE,
      height: Number.MAX_VALUE,
    };
    const fixture = buildFixture({
      textBBox: bbox,
      primitives: [{ id: "enormous", pageBBox: bbox }],
    });
    const first = buildDrawingSpatialRelations(fixture);
    const second = buildDrawingSpatialRelations(structuredClone(fixture));

    expect(first).toEqual(second);
    expect(first.relations).toEqual([]);
    expect(first.warnings).toContain(
      "UNREPRESENTABLE_GEOMETRY_PAIR count=1 firstTextEntity=item:item firstPrimitive=enormous",
    );
    expect(JSON.stringify(first)).not.toMatch(/NaN|Infinity/u);
  });

  it("does not let one unrepresentable pair remove another valid relation", () => {
    const textBBox = {
      x: 0,
      y: 0,
      width: Number.MAX_VALUE,
      height: Number.MAX_VALUE,
    };
    const result = buildDrawingSpatialRelations(
      buildFixture({
        textBBox,
        primitives: [
          {
            id: "normal",
            pageBBox: { x: 1, y: 1, width: 1, height: 1 },
          },
          { id: "enormous", pageBBox: textBBox },
        ],
      }),
    );

    expect(result.relations.map(({ primitiveId }) => primitiveId)).toEqual([
      "normal",
    ]);
    expect(result.warnings).toContain(
      "UNREPRESENTABLE_GEOMETRY_PAIR count=1 firstTextEntity=item:item firstPrimitive=enormous",
    );
  });

  it("keeps warnings and bytes deterministic across shuffled input", () => {
    const textBBox = {
      x: 0,
      y: 0,
      width: Number.MAX_VALUE,
      height: Number.MAX_VALUE,
    };
    const fixture = buildFixture({
      textBBox,
      primitives: [
        { id: "first", pageBBox: textBBox },
        { id: "second", pageBBox: textBBox },
      ],
    });
    const shuffled = structuredClone(fixture);
    shuffled.primitive.primitives.reverse();
    shuffled.classification.classifications.reverse();

    const first = buildDrawingSpatialRelations(fixture);
    const second = buildDrawingSpatialRelations(shuffled);

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.warnings).toContain(
      "UNREPRESENTABLE_GEOMETRY_PAIR count=2 firstTextEntity=item:item firstPrimitive=first",
    );
  });

  it("continues to reject non-finite input fields", () => {
    const fixture = buildFixture({
      primitives: [
        {
          id: "invalid",
          pageBBox: { x: Number.POSITIVE_INFINITY, y: 0, width: 1, height: 1 },
        },
      ],
    });

    expect(() => buildDrawingSpatialRelations(fixture)).toThrow(/finite|bbox/i);
  });
});

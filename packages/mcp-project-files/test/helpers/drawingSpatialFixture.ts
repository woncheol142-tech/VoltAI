import type {
  DrawingLayoutDocument,
  DrawingTextItem,
  DrawingTextLine,
  PageBBox as TextPageBBox,
} from "../../src/drawingLayout/types.js";
import type {
  DrawingPaintedPath,
  DrawingPrimitiveDocument,
  PageBBox,
} from "../../src/drawingPrimitive/types.js";
import type {
  DrawingPrimitiveClassificationDocument,
  PrimitiveClassification,
  PrimitiveClassificationKind,
  PrimitiveClassificationStatistics,
} from "../../src/drawingClassification/types.js";

export const SPATIAL_PAGE_WIDTH = 200;
export const SPATIAL_PAGE_HEIGHT = 200;
export const SPATIAL_SOURCE = "docs/spatial.pdf";
export const SPATIAL_SHA256 = "5".repeat(64);
export const SPATIAL_PAGE = 15;

function normalizedBBox(pageBBox: TextPageBBox) {
  return {
    x: pageBBox.x / SPATIAL_PAGE_WIDTH,
    y: pageBBox.y / SPATIAL_PAGE_HEIGHT,
    width: pageBBox.width / SPATIAL_PAGE_WIDTH,
    height: pageBBox.height / SPATIAL_PAGE_HEIGHT,
  };
}

export function makeSpatialTextItem(options: {
  id: string;
  sourceOrder: number;
  pageBBox: TextPageBBox;
  text?: string;
}): DrawingTextItem {
  const text = options.text ?? options.id;
  return {
    id: options.id,
    text,
    normalizedText: text.normalize("NFKC"),
    bbox: normalizedBBox(options.pageBBox),
    pageBBox: { ...options.pageBBox },
    rotation: 0,
    fontName: "FixtureFont",
    fontSize: 8,
    direction: "ltr",
    hasEOL: false,
    sourceOrder: options.sourceOrder,
    provenance: {
      transform: [8, 0, 0, 8, options.pageBBox.x, options.pageBBox.y],
      width: options.pageBBox.width,
      height: options.pageBBox.height,
    },
  };
}

export function makeSpatialTextLine(options: {
  id: string;
  itemIds: string[];
  sourceOrders: number[];
  pageBBox: TextPageBBox;
  text?: string;
}): DrawingTextLine {
  const text = options.text ?? options.id;
  return {
    id: options.id,
    text,
    normalizedText: text.normalize("NFKC"),
    bbox: normalizedBBox(options.pageBBox),
    pageBBox: { ...options.pageBBox },
    rotation: 0,
    itemIds: [...options.itemIds],
    sourceOrders: [...options.sourceOrders],
  };
}

export function makeSpatialLayout(options: {
  items?: DrawingTextItem[];
  lines?: DrawingTextLine[];
  warnings?: string[];
} = {}): DrawingLayoutDocument {
  const items = options.items ?? [];
  const lines = options.lines ?? [];
  return {
    schemaVersion: 1,
    source: SPATIAL_SOURCE,
    sourceSha256: SPATIAL_SHA256,
    page: SPATIAL_PAGE,
    pageCount: 100,
    pageWidth: SPATIAL_PAGE_WIDTH,
    pageHeight: SPATIAL_PAGE_HEIGHT,
    rotation: 0,
    cropBox: {
      x: 0,
      y: 0,
      width: SPATIAL_PAGE_WIDTH,
      height: SPATIAL_PAGE_HEIGHT,
    },
    coordinateSystem: "normalized-top-left",
    itemCount: items.length,
    lineCount: lines.length,
    items,
    lines,
    warnings: options.warnings ?? [],
  };
}

export function makeSpatialPrimitive(options: {
  id: string;
  sourceOrder: number;
  pageBBox: PageBBox;
}): DrawingPaintedPath {
  const { pageBBox } = options;
  return {
    id: options.id,
    type: "path",
    paint: "stroke",
    fillRule: null,
    bbox: normalizedBBox(pageBBox),
    pageBBox: { ...pageBBox },
    commands: [
      {
        command: "M",
        points: [
          {
            x: pageBBox.x / SPATIAL_PAGE_WIDTH,
            y: pageBBox.y / SPATIAL_PAGE_HEIGHT,
          },
        ],
      },
      {
        command: "L",
        points: [
          {
            x: (pageBBox.x + pageBBox.width) / SPATIAL_PAGE_WIDTH,
            y: (pageBBox.y + pageBBox.height) / SPATIAL_PAGE_HEIGHT,
          },
        ],
      },
    ],
    subpathCount: 1,
    closedSubpathCount: 0,
    style: {
      strokeWidthUserSpace: 1,
      lineCap: 0,
      lineJoin: 0,
      miterLimit: 10,
      dashArray: [],
      dashPhase: 0,
      strokeColor: "#000000",
      fillColor: null,
      strokeAlpha: 1,
      fillAlpha: 1,
    },
    sourceOrder: options.sourceOrder,
    provenance: {
      operatorIndex: options.sourceOrder,
      pathOperatorCount: 1,
    },
  };
}

export function makeSpatialPrimitiveDocument(
  primitives: DrawingPaintedPath[],
  warnings: string[] = [],
): DrawingPrimitiveDocument {
  return {
    schemaVersion: 1,
    source: SPATIAL_SOURCE,
    sourceSha256: SPATIAL_SHA256,
    page: SPATIAL_PAGE,
    pageCount: 100,
    pageWidth: SPATIAL_PAGE_WIDTH,
    pageHeight: SPATIAL_PAGE_HEIGHT,
    rotation: 0,
    cropBox: {
      x: 0,
      y: 0,
      width: SPATIAL_PAGE_WIDTH,
      height: SPATIAL_PAGE_HEIGHT,
    },
    coordinateSystem: "normalized-top-left",
    primitiveCount: primitives.length,
    primitives,
    warnings,
  };
}

function emptyStatistics(): PrimitiveClassificationStatistics {
  return {
    zeroLength: 0,
    tiny: 0,
    compoundPath: 0,
    curve: 0,
    rectangleCandidate: 0,
    closedPolygon: 0,
    polyline: 0,
    line: 0,
    unknown: 0,
    duplicateGroupCount: 0,
    duplicateMemberCount: 0,
  };
}

export function makeSpatialClassification(
  primitive: DrawingPaintedPath,
  kind: PrimitiveClassificationKind,
): PrimitiveClassification {
  return {
    primitiveId: primitive.id,
    kind,
    confidence: kind === "unknown" ? 0 : 1,
    diagnostics: {
      commandCount: primitive.commands.length,
      subpathCount: primitive.subpathCount,
      closedSubpathCount: primitive.closedSubpathCount,
      lineSegmentCount: 1,
      curveSegmentCount: 0,
      meaningfulEdgeCount: primitive.pageBBox.width === 0 &&
        primitive.pageBBox.height === 0
        ? 0
        : 1,
      duplicateGroupId: null,
      duplicateCount: 1,
    },
    geometry: {
      bbox: { ...primitive.bbox },
      pageBBox: { ...primitive.pageBBox },
    },
  };
}

export function makeSpatialClassificationDocument(
  primitives: DrawingPaintedPath[],
  kinds: PrimitiveClassificationKind[],
  warnings: string[] = [],
): DrawingPrimitiveClassificationDocument {
  const classifications = primitives.map((primitive, index) =>
    makeSpatialClassification(primitive, kinds[index] ?? "unknown")
  );
  const statistics = emptyStatistics();
  for (const classification of classifications) {
    statistics[classification.kind] += 1;
  }
  return {
    schemaVersion: 1,
    source: SPATIAL_SOURCE,
    sourceSha256: SPATIAL_SHA256,
    page: SPATIAL_PAGE,
    primitiveCount: primitives.length,
    classificationCount: classifications.length,
    statistics,
    classifications,
    warnings,
  };
}

export type DrawingSpatialFixture = {
  layout: DrawingLayoutDocument;
  primitive: DrawingPrimitiveDocument;
  classification: DrawingPrimitiveClassificationDocument;
};

export function createDrawingSpatialFixture(): DrawingSpatialFixture {
  const items = [
    makeSpatialTextItem({
      id: "item-inside",
      sourceOrder: 0,
      pageBBox: { x: 12, y: 12, width: 6, height: 4 },
    }),
    makeSpatialTextItem({
      id: "item-contains",
      sourceOrder: 1,
      pageBBox: { x: 40, y: 10, width: 10, height: 10 },
    }),
    makeSpatialTextItem({
      id: "item-overlap",
      sourceOrder: 2,
      pageBBox: { x: 58, y: 10, width: 10, height: 10 },
    }),
    makeSpatialTextItem({
      id: "item-edge-touch",
      sourceOrder: 3,
      pageBBox: { x: 80, y: 10, width: 10, height: 10 },
    }),
    makeSpatialTextItem({
      id: "item-corner-touch",
      sourceOrder: 4,
      pageBBox: { x: 10, y: 40, width: 10, height: 10 },
    }),
    makeSpatialTextItem({
      id: "item-proximity",
      sourceOrder: 5,
      pageBBox: { x: 20, y: 60, width: 10, height: 10 },
    }),
    makeSpatialTextItem({
      id: "item-equal",
      sourceOrder: 6,
      pageBBox: { x: 100, y: 10, width: 10, height: 10 },
    }),
    makeSpatialTextItem({
      id: "item-zero-area",
      sourceOrder: 7,
      pageBBox: { x: 120, y: 20, width: 0, height: 0 },
    }),
    makeSpatialTextItem({
      id: "item-off-page",
      sourceOrder: 8,
      pageBBox: { x: -20, y: 90, width: 8, height: 8 },
    }),
    makeSpatialTextItem({
      id: "item-duplicate-geometry-a",
      sourceOrder: 9,
      pageBBox: { x: 160, y: 10, width: 4, height: 4 },
    }),
    makeSpatialTextItem({
      id: "item-duplicate-geometry-b",
      sourceOrder: 10,
      pageBBox: { x: 160, y: 10, width: 4, height: 4 },
    }),
  ];
  const lines = [
    makeSpatialTextLine({
      id: "line-inside",
      itemIds: ["item-inside"],
      sourceOrders: [0],
      pageBBox: { x: 11, y: 11, width: 8, height: 6 },
    }),
    makeSpatialTextLine({
      id: "line-proximity",
      itemIds: ["item-proximity"],
      sourceOrders: [5],
      pageBBox: { x: 20, y: 59, width: 10, height: 12 },
    }),
    makeSpatialTextLine({
      id: "line-zero-area",
      itemIds: ["item-zero-area"],
      sourceOrders: [7],
      pageBBox: { x: 120, y: 20, width: 0, height: 0 },
    }),
  ];
  const primitiveData: Array<{
    id: string;
    pageBBox: PageBBox;
    kind: PrimitiveClassificationKind;
  }> = [
    {
      id: "primitive-container",
      pageBBox: { x: 10, y: 10, width: 20, height: 10 },
      kind: "rectangleCandidate",
    },
    {
      id: "primitive-inside",
      pageBBox: { x: 43, y: 13, width: 1, height: 1 },
      kind: "tiny",
    },
    {
      id: "primitive-overlap",
      pageBBox: { x: 64, y: 10, width: 10, height: 10 },
      kind: "compoundPath",
    },
    {
      id: "primitive-edge-touch",
      pageBBox: { x: 90, y: 12, width: 5, height: 5 },
      kind: "curve",
    },
    {
      id: "primitive-corner-touch",
      pageBBox: { x: 20, y: 50, width: 5, height: 5 },
      kind: "line",
    },
    {
      id: "primitive-adjacent",
      pageBBox: { x: 31.999, y: 62, width: 2, height: 2 },
      kind: "polyline",
    },
    {
      id: "primitive-non-adjacent",
      pageBBox: { x: 32.001, y: 66, width: 2, height: 2 },
      kind: "line",
    },
    {
      id: "primitive-nearest",
      pageBBox: { x: 37.999, y: 60, width: 2, height: 2 },
      kind: "line",
    },
    {
      id: "primitive-nearest-excluded",
      pageBBox: { x: 38.001, y: 60, width: 2, height: 2 },
      kind: "line",
    },
    {
      id: "primitive-equal",
      pageBBox: { x: 100, y: 10, width: 10, height: 10 },
      kind: "rectangleCandidate",
    },
    {
      id: "primitive-zero-area",
      pageBBox: { x: 120, y: 20, width: 0, height: 0 },
      kind: "zeroLength",
    },
    {
      id: "primitive-off-page",
      pageBBox: { x: -18, y: 90, width: 1, height: 1 },
      kind: "tiny",
    },
    {
      id: "primitive-duplicate-geometry-a",
      pageBBox: { x: 140, y: 30, width: 4, height: 4 },
      kind: "line",
    },
    {
      id: "primitive-duplicate-geometry-b",
      pageBBox: { x: 140, y: 30, width: 4, height: 4 },
      kind: "line",
    },
    {
      id: "primitive-large-overflow",
      pageBBox: { x: -1_000, y: -1_000, width: 65, height: 65 },
      kind: "rectangleCandidate",
    },
  ];
  const primitives = primitiveData.map((entry, sourceOrder) =>
    makeSpatialPrimitive({
      id: entry.id,
      sourceOrder,
      pageBBox: entry.pageBBox,
    })
  );

  return {
    layout: makeSpatialLayout({
      items,
      lines,
      warnings: ["LAYOUT_FIXTURE_WARNING"],
    }),
    primitive: makeSpatialPrimitiveDocument(primitives, [
      "PRIMITIVE_FIXTURE_WARNING",
    ]),
    classification: makeSpatialClassificationDocument(
      primitives,
      primitiveData.map(({ kind }) => kind),
      ["CLASSIFICATION_FIXTURE_WARNING"],
    ),
  };
}

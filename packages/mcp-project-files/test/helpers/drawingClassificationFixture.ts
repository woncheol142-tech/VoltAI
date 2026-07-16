import type {
  DrawingPaintedPath,
  DrawingPathCommand,
  DrawingPrimitiveDocument,
  NormalizedPoint,
  PageBBox,
} from "../../src/drawingPrimitive/types.js";

const PAGE_WIDTH = 1_000;
const PAGE_HEIGHT = 1_000;

type PagePoint = readonly [x: number, y: number];
type PageCommand =
  | { command: "M" | "L"; points: readonly [PagePoint] }
  | { command: "Q"; points: readonly [PagePoint, PagePoint] }
  | { command: "C"; points: readonly [PagePoint, PagePoint, PagePoint] }
  | { command: "Z"; points: readonly [] };

const defaultStyle: DrawingPaintedPath["style"] = {
  strokeWidthUserSpace: 1,
  lineCap: 0,
  lineJoin: 0,
  miterLimit: 10,
  dashArray: [],
  dashPhase: 0,
  strokeColor: "#000000",
  fillColor: "#ffffff",
  strokeAlpha: 1,
  fillAlpha: 1,
};

function normalizedPoint([x, y]: PagePoint): NormalizedPoint {
  return { x: x / PAGE_WIDTH, y: y / PAGE_HEIGHT };
}

function normalizeCommands(commands: readonly PageCommand[]): DrawingPathCommand[] {
  return commands.map((command) => {
    if (command.command === "Z") return { command: "Z", points: [] };
    if (command.command === "M" || command.command === "L") {
      return {
        command: command.command,
        points: [normalizedPoint(command.points[0])],
      };
    }
    if (command.command === "Q") {
      return {
        command: "Q",
        points: [
          normalizedPoint(command.points[0]),
          normalizedPoint(command.points[1]),
        ],
      };
    }
    return {
      command: "C",
      points: [
        normalizedPoint(command.points[0]),
        normalizedPoint(command.points[1]),
        normalizedPoint(command.points[2]),
      ],
    };
  });
}

function commandPoints(commands: readonly PageCommand[]): PagePoint[] {
  return commands.flatMap((command) => [...command.points]);
}

function bounds(commands: readonly PageCommand[]): PageBBox {
  const points = commandPoints(commands);
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

function normalizedBounds(pageBBox: PageBBox) {
  return {
    x: pageBBox.x / PAGE_WIDTH,
    y: pageBBox.y / PAGE_HEIGHT,
    width: pageBBox.width / PAGE_WIDTH,
    height: pageBBox.height / PAGE_HEIGHT,
  };
}

export function makeClassificationPrimitive(options: {
  id: string;
  sourceOrder: number;
  commands: readonly PageCommand[];
  subpathCount?: number;
  closedSubpathCount?: number;
  pageBBox?: PageBBox;
  paint?: DrawingPaintedPath["paint"];
  style?: Partial<DrawingPaintedPath["style"]>;
}): DrawingPaintedPath {
  const pageBBox = options.pageBBox ?? bounds(options.commands);
  return {
    id: options.id,
    type: "path",
    paint: options.paint ?? "stroke",
    fillRule: null,
    bbox: normalizedBounds(pageBBox),
    pageBBox: { ...pageBBox },
    commands: normalizeCommands(options.commands),
    subpathCount: options.subpathCount ?? 1,
    closedSubpathCount: options.closedSubpathCount ?? 0,
    style: {
      ...defaultStyle,
      ...options.style,
      dashArray:
        options.style?.dashArray === undefined
          ? [...(defaultStyle.dashArray ?? [])]
          : options.style.dashArray,
    },
    sourceOrder: options.sourceOrder,
    provenance: {
      operatorIndex: options.sourceOrder * 10,
      pathOperatorCount: options.commands.length,
    },
  };
}

export function makeClassificationDocument(
  primitives: DrawingPaintedPath[],
  warnings: string[] = [],
): DrawingPrimitiveDocument {
  return {
    schemaVersion: 1,
    source: "docs/classification.pdf",
    sourceSha256: "c".repeat(64),
    page: 69,
    pageCount: 100,
    pageWidth: PAGE_WIDTH,
    pageHeight: PAGE_HEIGHT,
    rotation: 0,
    cropBox: { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT },
    coordinateSystem: "normalized-top-left",
    primitiveCount: primitives.length,
    primitives,
    warnings,
  };
}

export const pageCommands = {
  line: (start: PagePoint, end: PagePoint): PageCommand[] => [
    { command: "M", points: [start] },
    { command: "L", points: [end] },
  ],
  polygon: (
    points: readonly PagePoint[],
    closure: "Z" | "repeat" = "Z",
  ): PageCommand[] => {
    const [first, ...rest] = points;
    if (!first) return [];
    return [
      { command: "M", points: [first] },
      ...rest.map((point) => ({ command: "L" as const, points: [point] as const })),
      ...(closure === "repeat"
        ? [{ command: "L" as const, points: [first] as const }]
        : [{ command: "Z" as const, points: [] as const }]),
    ];
  },
};

export function createDrawingClassificationFixture(): DrawingPrimitiveDocument {
  const primitive = (
    id: string,
    sourceOrder: number,
    commands: readonly PageCommand[],
    overrides: Omit<
      Parameters<typeof makeClassificationPrimitive>[0],
      "id" | "sourceOrder" | "commands"
    > = {},
  ) =>
    makeClassificationPrimitive({ id, sourceOrder, commands, ...overrides });

  const lineCommands = pageCommands.line([100, 100], [300, 100]);
  return makeClassificationDocument([
    primitive("line", 0, lineCommands),
    primitive("polyline", 1, [
      { command: "M", points: [[100, 150]] },
      { command: "L", points: [[200, 150]] },
      { command: "L", points: [[250, 200]] },
    ]),
    primitive(
      "axis-rectangle",
      2,
      pageCommands.polygon([
        [100, 250],
        [300, 250],
        [300, 350],
        [100, 350],
      ]),
      { closedSubpathCount: 1 },
    ),
    primitive(
      "rotated-rectangle",
      3,
      pageCommands.polygon([
        [500, 200],
        [600, 300],
        [500, 400],
        [400, 300],
      ]),
      { closedSubpathCount: 1 },
    ),
    primitive(
      "trapezoid",
      4,
      pageCommands.polygon([
        [100, 450],
        [320, 450],
        [280, 550],
        [140, 550],
      ]),
      { closedSubpathCount: 1 },
    ),
    primitive(
      "triangle",
      5,
      pageCommands.polygon([
        [400, 450],
        [550, 450],
        [475, 560],
      ]),
      { closedSubpathCount: 1 },
    ),
    primitive("open-curve", 6, [
      { command: "M", points: [[650, 100]] },
      { command: "Q", points: [[700, 20], [760, 100]] },
    ]),
    primitive(
      "closed-curve",
      7,
      [
        { command: "M", points: [[650, 200]] },
        { command: "C", points: [[680, 150], [730, 150], [760, 200]] },
        { command: "L", points: [[650, 200]] },
        { command: "Z", points: [] },
      ],
      { closedSubpathCount: 1 },
    ),
    primitive(
      "compound-lines",
      8,
      [
        ...pageCommands.line([650, 300], [760, 300]),
        ...pageCommands.line([650, 330], [760, 330]),
      ],
      { subpathCount: 2 },
    ),
    primitive(
      "compound-curve-polygon",
      9,
      [
        { command: "M", points: [[650, 400]] },
        { command: "Q", points: [[700, 350], [760, 400]] },
        ...pageCommands.polygon([
          [650, 450],
          [760, 450],
          [700, 520],
        ]),
      ],
      { subpathCount: 2, closedSubpathCount: 1 },
    ),
    primitive("tiny-line", 10, pageCommands.line([100, 650], [100.999, 650]), {
      pageBBox: { x: 100, y: 650, width: 0.999, height: 0 },
    }),
    primitive("zero-length", 11, pageCommands.line([200, 650], [200, 650]), {
      pageBBox: { x: 200, y: 650, width: 0, height: 0 },
    }),
    primitive(
      "unknown-closed-segment",
      12,
      [
        { command: "M", points: [[300, 650]] },
        { command: "L", points: [[400, 650]] },
        { command: "Z", points: [] },
      ],
      { closedSubpathCount: 1 },
    ),
    primitive("line-duplicate", 13, lineCommands, {
      paint: "fill-stroke",
      style: { strokeWidthUserSpace: 7, strokeColor: "#ff0000" },
    }),
    primitive(
      "parallelogram",
      14,
      pageCommands.polygon([
        [450, 620],
        [620, 620],
        [670, 720],
        [500, 720],
      ]),
      { closedSubpathCount: 1 },
    ),
    primitive(
      "bow-tie",
      15,
      pageCommands.polygon([
        [720, 600],
        [850, 720],
        [720, 720],
        [850, 600],
      ]),
      { closedSubpathCount: 1 },
    ),
    primitive(
      "concave-polygon",
      16,
      pageCommands.polygon([
        [50, 780],
        [250, 780],
        [150, 830],
        [250, 880],
        [50, 880],
      ]),
      { closedSubpathCount: 1 },
    ),
  ]);
}

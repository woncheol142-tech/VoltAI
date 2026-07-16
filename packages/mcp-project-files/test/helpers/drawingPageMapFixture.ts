import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type {
  DrawingIndexDocument,
  DrawingIndexRecord,
} from "../../src/drawingIndex/types.js";

export type DrawingPageFixtureTextItem = {
  str: string;
  transform: readonly [number, number, number, number, number, number];
  width: number;
  height: number;
};

export type DrawingPageFixtureTextPage = {
  page: number;
  width: number;
  height: number;
  rotation: 0 | 90;
  items: DrawingPageFixtureTextItem[];
};

type DrawingPageFixtureOptions = {
  page?: number;
  drawingNo?: string;
  title?: string | null;
  bodyDrawingNos?: string[];
  secondaryDrawingNo?: string;
  secondaryTitle?: string | null;
  width?: number;
  height?: number;
  rotation?: 0 | 90;
  splitNumber?: boolean;
  fullWidthNumber?: boolean;
  includeNul?: boolean;
  streamOrder?: "number-first" | "number-last" | "shuffled";
};

export type DrawingPageMapFixtureDocument = {
  schemaVersion: 1;
  source: string;
  sourceSha256: string;
  indexPath: string;
  indexSourceSha256: string;
  startPage: number;
  endPage: number;
  scannedPageCount: number;
  indexedDrawingCount: number;
  mappingCount: number;
  unmatchedCount: number;
  coverageRatio: number;
  mappings: Array<{
    drawingNo: string;
    drawingPage: number;
    detectedTitle: string | null;
    confidence: number;
    matchMethod: "title-block-coordinate";
    rawText?: string;
  }>;
  unmatchedDrawingNumbers: string[];
  duplicatePageMatches: Array<{ drawingNo: string; pages: number[] }>;
  warnings: string[];
  relativePageMapPath?: string;
};

const fixtureSha256 = "a".repeat(64);

export function roundFixtureCoverage(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function fixtureDrawing(
  drawingNo: string,
  title: string,
  sourceListPage = 1,
): DrawingIndexRecord {
  return {
    drawingNo,
    title,
    category: drawingNo.startsWith("MA-") ? "기계" : "기타",
    complex: null,
    building: null,
    floor: null,
    scaleA1: null,
    scaleA3: null,
    sourceListPage,
    confidence: 1,
  };
}

export function createDrawingPageMapIndex(
  overrides: Partial<DrawingIndexDocument> = {},
): DrawingIndexDocument {
  const drawings =
    overrides.drawings ??
    [
      fixtureDrawing("E-401", "1단지 101동 지하2층 전력간선설비 평면도"),
      fixtureDrawing("E-154A", "1단지 MCC 결선도-19"),
      fixtureDrawing("MA-010", "기계 장비일람표-1"),
      fixtureDrawing("MF-020", "소방기계 장비일람표"),
      fixtureDrawing("E-500", "첫 번째 모호한 도면"),
      fixtureDrawing("E-501", "두 번째 모호한 도면"),
    ];

  return {
    schemaVersion: 1,
    source: "docs/drawings.pdf",
    sourceSha256: fixtureSha256,
    startPage: 1,
    endPage: 1,
    drawingCount: drawings.length,
    drawings,
    warnings: [],
    ...overrides,
  };
}

function verticalItem(
  text: string,
  x: number,
  y: number,
  scaleX: number,
  scaleY: number,
): DrawingPageFixtureTextItem {
  return {
    str: text,
    transform: [0, -6.3 * scaleY, 6.3 * scaleX, 0, x, y],
    width: text.length * 6.3 * scaleY,
    height: 6.3 * scaleX,
  };
}

function horizontalItem(
  text: string,
  x: number,
  y: number,
  scaleX: number,
  scaleY: number,
): DrawingPageFixtureTextItem {
  return {
    str: text,
    transform: [6.3 * scaleX, 0, 0, 6.3 * scaleY, x, y],
    width: text.length * 6.3 * scaleX,
    height: 6.3 * scaleY,
  };
}

function normalizeFixtureNumber(
  drawingNo: string,
  fullWidth: boolean,
  includeNul: boolean,
): string {
  const value = fullWidth
    ? drawingNo.replace(/[A-Z0-9-]/gu, (character) => {
        if (character === "-") return "－";
        return String.fromCodePoint(character.codePointAt(0)! + 0xfee0);
      })
    : drawingNo;
  return includeNul ? `${value.slice(0, 2)}\u0000${value.slice(2)}` : value;
}

function titleBlockNumberItems(
  drawingNo: string,
  x: number,
  scaleX: number,
  scaleY: number,
  options: Pick<DrawingPageFixtureOptions, "splitNumber" | "fullWidthNumber" | "includeNul">,
): DrawingPageFixtureTextItem[] {
  const normalized = normalizeFixtureNumber(
    drawingNo,
    options.fullWidthNumber ?? false,
    options.includeNul ?? false,
  );
  const separator = normalized.indexOf(options.fullWidthNumber ? "－" : "-");
  const prefix = normalized.slice(0, separator + 1);
  const suffix = normalized.slice(separator + 1);
  const items = [verticalItem(prefix[0] ?? "E", x, 126.5 * scaleY, scaleX, scaleY)];

  if (options.splitNumber === false) {
    items.push(verticalItem(normalized, x, 120.2 * scaleY, scaleX, scaleY));
  } else {
    items.push(verticalItem(prefix, x, 120.2 * scaleY, scaleX, scaleY));
    items.push(verticalItem(suffix, x, 75.5 * scaleY, scaleX, scaleY));
  }

  return items;
}

function titleItems(
  title: string | null | undefined,
  scaleX: number,
  scaleY: number,
  xOffset = 0,
): DrawingPageFixtureTextItem[] {
  if (!title) return [];
  const splitAt = Math.max(1, Math.ceil(title.length / 2));
  return [
    verticalItem(title.slice(0, splitAt), (89 + xOffset) * scaleX, 122 * scaleY, scaleX, scaleY),
    verticalItem(title.slice(splitAt), (83 + xOffset) * scaleX, 122 * scaleY, scaleX, scaleY),
  ].filter((item) => item.str.length > 0);
}

export function createDrawingPageTextFixture(
  options: DrawingPageFixtureOptions = {},
): DrawingPageFixtureTextPage {
  const width = options.width ?? 595;
  const height = options.height ?? 842;
  const scaleX = width / 595;
  const scaleY = height / 842;
  const drawingNo = options.drawingNo ?? "E-401";
  const numberItems = titleBlockNumberItems(drawingNo, 65.9 * scaleX, scaleX, scaleY, options);
  const primaryTitle =
    options.title === undefined
      ? "1단지 101동 지하2층 전력간선설비 평면도"
      : options.title;
  const primaryTitleItems = titleItems(primaryTitle, scaleX, scaleY);
  const secondaryItems = options.secondaryDrawingNo
    ? [
        ...titleBlockNumberItems(
          options.secondaryDrawingNo,
          69.5 * scaleX,
          scaleX,
          scaleY,
          options,
        ),
        ...titleItems(options.secondaryTitle, scaleX, scaleY, 3.6),
      ]
    : [];
  const bodyItems = (options.bodyDrawingNos ?? []).map((bodyDrawingNo, index) =>
    horizontalItem(bodyDrawingNo, (280 + index * 30) * scaleX, 420 * scaleY, scaleX, scaleY),
  );
  const items = [...numberItems, ...primaryTitleItems, ...secondaryItems, ...bodyItems];
  const streamOrder = options.streamOrder ?? "shuffled";

  return {
    page: options.page ?? 2,
    width,
    height,
    rotation: options.rotation ?? 0,
    items:
      streamOrder === "number-first"
        ? items
        : streamOrder === "number-last"
          ? [...bodyItems, ...primaryTitleItems, ...secondaryItems, ...numberItems]
          : items.filter((_, index) => index % 2 === 1).concat(items.filter((_, index) => index % 2 === 0)),
  };
}

function toPdfHex(text: string): string {
  return Buffer.from(text, "utf16le").swap16().toString("hex").toUpperCase();
}

function toPdfTextCommand(item: DrawingPageFixtureTextItem): string {
  const [a, b, c, d, x, y] = item.transform;
  return `BT /F1 8 Tf ${a / 8} ${b / 8} ${c / 8} ${d / 8} ${x} ${y} Tm <${toPdfHex(item.str)}> Tj ET`;
}

function pdfStream(content: string): string {
  return `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
}

function createListPage(): DrawingPageFixtureTextPage {
  return {
    page: 1,
    width: 595,
    height: 842,
    rotation: 0,
    items: [horizontalItem("DRAWING LIST", 72, 760, 1, 1)],
  };
}

export function createDrawingPagesPdfFixture(): Uint8Array {
  const pages = [
    createListPage(),
    createDrawingPageTextFixture({
      page: 2,
      drawingNo: "E-401",
      title: "1단지 101동 지하2층 전력간선설비 평면도",
      bodyDrawingNos: ["E-500"],
    }),
    createDrawingPageTextFixture({ page: 3, drawingNo: "E-154A", title: null }),
    createDrawingPageTextFixture({
      page: 4,
      drawingNo: "MA-010",
      title: "목록과 다른 기계 도면 제목",
    }),
    {
      page: 5,
      width: 595,
      height: 842,
      rotation: 0 as const,
      items: [horizontalItem("E-401 body reference only", 280, 420, 1, 1)],
    },
    createDrawingPageTextFixture({ page: 6, drawingNo: "E-401" }),
    createDrawingPageTextFixture({
      page: 7,
      drawingNo: "E-500",
      title: null,
      secondaryDrawingNo: "E-501",
      secondaryTitle: null,
    }),
    createDrawingPageTextFixture({
      page: 8,
      drawingNo: "MF-020",
      title: "소방기계 장비일람표",
      width: 842,
      height: 595,
      rotation: 90,
    }),
  ];
  const toUnicode = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
1 beginbfrange
<0000> <FFFF> <0000>
endbfrange
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
  const firstPageObject = 6;
  const firstContentObject = firstPageObject + pages.length;
  const pageReferences = pages.map((_, index) => `${firstPageObject + index} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageReferences}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type0 /BaseFont /VoltAiPageMapFixture /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 5 0 R >>",
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /VoltAiPageMapFixture /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /CIDToGIDMap /Identity /DW 1000 >>",
    pdfStream(toUnicode),
    ...pages.map((page, index) => {
      const rotation = page.rotation === 0 ? "" : ` /Rotate ${page.rotation}`;
      return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}]${rotation} /Resources << /Font << /F1 3 0 R >> >> /Contents ${firstContentObject + index} 0 R >>`;
    }),
    ...pages.map((page) => pdfStream(page.items.map(toPdfTextCommand).join("\n"))),
  ];

  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf));
}

export function writeDrawingPageMapProject(
  projectRoot: string,
  options: {
    sourcePath?: string;
    indexPath?: string;
    indexOverrides?: Partial<DrawingIndexDocument>;
  } = {},
): {
  sourcePath: string;
  indexPath: string;
  sourceSha256: string;
  index: DrawingIndexDocument;
} {
  const sourcePath = options.sourcePath ?? "docs/drawings.pdf";
  const indexPath = options.indexPath ?? ".volt-ai/indexes/drawing-index.json";
  const sourceBytes = createDrawingPagesPdfFixture();
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const index = createDrawingPageMapIndex({
    source: sourcePath,
    sourceSha256,
    ...options.indexOverrides,
  });
  const absoluteSourcePath = join(projectRoot, ...sourcePath.split("/"));
  const absoluteIndexPath = join(projectRoot, ...indexPath.split("/"));
  mkdirSync(dirname(absoluteSourcePath), { recursive: true });
  mkdirSync(dirname(absoluteIndexPath), { recursive: true });
  writeFileSync(absoluteSourcePath, sourceBytes);
  writeFileSync(absoluteIndexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return { sourcePath, indexPath, sourceSha256, index };
}

export function createValidPageMapDocument(
  overrides: Partial<DrawingPageMapFixtureDocument> = {},
): DrawingPageMapFixtureDocument {
  const mappings =
    overrides.mappings ??
    [
      {
        drawingNo: "E-401",
        drawingPage: 2,
        detectedTitle: "1단지 101동 지하2층 전력간선설비 평면도",
        confidence: 0.99,
        matchMethod: "title-block-coordinate" as const,
      },
      {
        drawingNo: "E-154A",
        drawingPage: 3,
        detectedTitle: null,
        confidence: 0.85,
        matchMethod: "title-block-coordinate" as const,
      },
      {
        drawingNo: "MA-010",
        drawingPage: 4,
        detectedTitle: "목록과 다른 기계 도면 제목",
        confidence: 0.8,
        matchMethod: "title-block-coordinate" as const,
      },
    ];
  const unmatchedDrawingNumbers = overrides.unmatchedDrawingNumbers ?? ["E-500", "E-501", "MF-020"];

  return {
    schemaVersion: 1,
    source: "docs/drawings.pdf",
    sourceSha256: fixtureSha256,
    indexPath: ".volt-ai/indexes/drawing-index.json",
    indexSourceSha256: fixtureSha256,
    startPage: 2,
    endPage: 8,
    scannedPageCount: 7,
    indexedDrawingCount: 6,
    mappingCount: mappings.length,
    unmatchedCount: unmatchedDrawingNumbers.length,
    coverageRatio: roundFixtureCoverage(mappings.length / 6),
    mappings,
    unmatchedDrawingNumbers,
    duplicatePageMatches: [],
    warnings: [],
    ...overrides,
  };
}

export function writePageMapFixture(
  projectRoot: string,
  document: DrawingPageMapFixtureDocument = createValidPageMapDocument(),
  pageMapPath = ".volt-ai/page-maps/drawing-pages.json",
): string {
  const absolutePath = join(projectRoot, ...pageMapPath.split("/"));
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return absolutePath;
}

export function fixtureSourceSha256(): string {
  return fixtureSha256;
}

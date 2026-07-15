import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type DrawingListFixtureTextItem = {
  str: string;
  transform: readonly [number, number, number, number, number, number];
  width: number;
  height: number;
};

export type DrawingListFixturePage = {
  page: number;
  items: DrawingListFixtureTextItem[];
};

export type DrawingListFixtureRow = {
  drawingNo: string;
  title: string;
  scaleA1?: string;
  scaleA3?: string;
  row: number;
  block?: "upper" | "lower";
  titleRowOffset?: number;
};

type PositionedText = {
  text: string;
  x: number;
  y: number;
  order: number;
};

const blockColumns = {
  upper: {
    drawingPrefix: 753,
    drawingDigits: 747,
    title: 735,
    scaleA1: 609,
    scaleA3: 582,
    headers: {
      drawingNo: 762,
      title: 690,
      scaleA1: 607,
      scaleA3: 580,
    },
  },
  lower: {
    drawingPrefix: 437,
    drawingDigits: 431,
    title: 419,
    scaleA1: 293,
    scaleA3: 266,
    headers: {
      drawingNo: 446,
      title: 374,
      scaleA1: 291,
      scaleA3: 264,
    },
  },
} as const;

function fixtureItem(text: string, x: number, y: number): DrawingListFixtureTextItem {
  return {
    str: text,
    transform: [0, -8, 8, 0, x, y],
    width: text.length * 8,
    height: 8,
  };
}

function splitDrawingNo(drawingNo: string): [string, string] {
  const separator = drawingNo.indexOf("-");
  return [drawingNo.slice(0, separator + 1), drawingNo.slice(separator + 1)];
}

function headerItems(block: "upper" | "lower"): PositionedText[] {
  const columns = blockColumns[block].headers;
  return [
    { text: "도면번호", x: 530, y: columns.drawingNo, order: 90 },
    { text: "도면명", x: 530, y: columns.title, order: 10 },
    { text: "A1", x: 524, y: columns.scaleA1, order: 70 },
    { text: "A3", x: 524, y: columns.scaleA3, order: 30 },
  ];
}

function rowItems(row: DrawingListFixtureRow): PositionedText[] {
  const block = row.block ?? "upper";
  const columns = blockColumns[block];
  const x = 500 - row.row * 20;
  const [prefix, digits] = splitDrawingNo(row.drawingNo);
  const titleX = x + (row.titleRowOffset ?? 0);

  return [
    { text: row.title, x: titleX, y: columns.title, order: 15 + row.row },
    { text: row.scaleA3 ?? "", x, y: columns.scaleA3, order: 25 + row.row },
    { text: digits, x, y: columns.drawingDigits, order: 35 + row.row },
    { text: row.scaleA1 ?? "", x, y: columns.scaleA1, order: 45 + row.row },
    { text: prefix, x, y: columns.drawingPrefix, order: 55 + row.row },
  ].filter((item) => item.text.length > 0);
}

export function createDrawingListTextPage(
  page: number,
  rows: DrawingListFixtureRow[],
  options: { includeUpperHeader?: boolean; includeLowerHeader?: boolean } = {},
): DrawingListFixturePage {
  const positioned = [
    ...(options.includeUpperHeader === false ? [] : headerItems("upper")),
    ...(options.includeLowerHeader === false ? [] : headerItems("lower")),
    ...rows.flatMap(rowItems),
  ];

  return {
    page,
    items: positioned
      .sort((left, right) => left.order - right.order)
      .map((item) => fixtureItem(item.text, item.x, item.y)),
  };
}

export function createTwoPageDrawingListTextFixture(): DrawingListFixturePage[] {
  const pageOneRows: DrawingListFixtureRow[] = [
    {
      drawingNo: "E-001",
      title: "도면목록표-1",
      scaleA1: "NONE",
      scaleA3: "NONE",
      row: 1,
      block: "upper",
    },
    {
      drawingNo: "E-154A",
      title: "1단지 101동 지하2층 전력간선설비 평면도",
      scaleA1: "1/100",
      scaleA3: "1/200",
      row: 2,
      block: "upper",
    },
    {
      drawingNo: "MA-010",
      title: "기계설비 상세도",
      scaleA1: "1/50",
      scaleA3: "1/100",
      row: 1,
      block: "lower",
    },
    {
      drawingNo: "E-001",
      title: "도면목록표-중복",
      scaleA1: "NONE",
      scaleA3: "NONE",
      row: 2,
      block: "lower",
    },
  ];
  const pageTwoRows: DrawingListFixtureRow[] = [
    {
      drawingNo: "E-454P",
      title: "1단지 106동 PIT층 전등설비 평면도",
      scaleA1: "1/100",
      scaleA3: "1/200",
      row: 1,
      block: "upper",
    },
    {
      drawingNo: "MF-020",
      title: "2단지 201동 옥탑지붕층 소방설비 평면도",
      scaleA1: "1/125",
      scaleA3: "1/250",
      row: 1,
      block: "lower",
    },
    {
      drawingNo: "E-999",
      title: "모호한 제목 A",
      scaleA1: "1/100",
      scaleA3: "1/200",
      row: 3,
      block: "upper",
      titleRowOffset: -5,
    },
    {
      drawingNo: "E-998",
      title: "모호한 제목 B",
      scaleA1: "1/100",
      scaleA3: "1/200",
      row: 3,
      block: "upper",
      titleRowOffset: 5,
    },
  ];

  return [
    createDrawingListTextPage(1, pageOneRows),
    createDrawingListTextPage(2, pageTwoRows),
  ];
}

function toPdfHex(text: string): string {
  return Buffer.from(text, "utf16le").swap16().toString("hex").toUpperCase();
}

function toPdfTextCommand(item: DrawingListFixtureTextItem): string {
  const [, b, c, , x, y] = item.transform;
  return `BT /F1 8 Tf 0 ${b / 8} ${c / 8} 0 ${x} ${y} Tm <${toPdfHex(item.str)}> Tj ET`;
}

function pdfStream(content: string): string {
  return `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
}

export function createDrawingListPdfFixture(): Uint8Array {
  const pages = createTwoPageDrawingListTextFixture();
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
  const pageReferences = pages
    .map((_, index) => `${firstPageObject + index} 0 R`)
    .join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageReferences}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type0 /BaseFont /VoltAiFixture /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 5 0 R >>",
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /VoltAiFixture /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /CIDToGIDMap /Identity /DW 1000 >>",
    pdfStream(toUnicode),
    ...pages.map(
      (_, index) =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${firstContentObject + index} 0 R >>`,
    ),
    ...pages.map((page) => pdfStream(page.items.map(toPdfTextCommand).join("\n"))),
  ];

  let pdf = "%PDF-1.7\n";
  const offsets = [0];

  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, "binary"));
}

export function writeDrawingListFixture(
  root: string,
  relativePath = "docs/drawing-list.pdf",
): void {
  const parts = relativePath.split("/");
  const fileName = parts.pop();

  if (!fileName) {
    throw new Error("relativePath must include a file name");
  }

  mkdirSync(join(root, ...parts), { recursive: true });
  writeFileSync(join(root, ...parts, fileName), createDrawingListPdfFixture());
}

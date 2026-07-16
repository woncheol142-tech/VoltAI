import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type LayoutFixtureTextItem = {
  str: string;
  transform: readonly [number, number, number, number, number, number];
  width: number;
  height: number;
  fontName?: string;
  dir?: "ltr" | "rtl" | "ttb";
  hasEOL?: boolean;
};

export type LayoutFixturePageInput = {
  page: number;
  pageWidth: number;
  pageHeight: number;
  cropBox: { x: number; y: number; width: number; height: number };
  rotation: number;
  viewportTransform: readonly [number, number, number, number, number, number];
  items: readonly LayoutFixtureTextItem[];
};

type PdfText = {
  text: string;
  x: number;
  y: number;
  fontSize?: number;
  angle?: number;
};

type PdfPage = {
  mediaBox: readonly [number, number, number, number];
  cropBox?: readonly [number, number, number, number];
  rotation?: 0 | 90 | 180 | 270;
  texts?: PdfText[];
  vectorOnly?: boolean;
};

function toPdfHex(text: string): string {
  return Buffer.from(text, "utf16le").swap16().toString("hex").toUpperCase();
}

function number(value: number): string {
  return Number(value.toFixed(8)).toString();
}

function textCommand(item: PdfText): string {
  const angle = ((item.angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const fontSize = item.fontSize ?? 12;

  return [
    "BT",
    `/F1 ${number(fontSize)} Tf`,
    `${number(cos)} ${number(sin)} ${number(-sin)} ${number(cos)} ${number(item.x)} ${number(item.y)} Tm`,
    `<${toPdfHex(item.text)}> Tj`,
    "ET",
  ].join(" ");
}

function stream(content: string): string {
  return `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
}

function fixturePages(): PdfPage[] {
  return [
    {
      mediaBox: [0, 0, 600, 800],
      texts: [
        { text: "오른쪽 셀", x: 430, y: 650 },
        { text: "154A", x: 124, y: 700 },
        { text: "225AF", x: 236, y: 650 },
        { text: "E-", x: 100, y: 700 },
        { text: "MCCB", x: 180, y: 650 },
        { text: "1", x: 100, y: 600 },
        { text: "단지", x: 108, y: 600 },
        { text: "한글 English 380V", x: 100, y: 550 },
      ],
    },
    {
      mediaBox: [0, 0, 600, 800],
      rotation: 90,
      texts: [
        { text: "90-B", x: 100, y: 650 },
        { text: "90-A", x: 100, y: 700 },
      ],
    },
    {
      mediaBox: [0, 0, 640, 480],
      rotation: 180,
      texts: [
        { text: "180-B", x: 160, y: 300 },
        { text: "180-A", x: 100, y: 300 },
      ],
    },
    {
      mediaBox: [0, 0, 600, 800],
      rotation: 270,
      texts: [
        { text: "MCCB", x: 120, y: 680 },
        { text: "400AF", x: 120, y: 620 },
      ],
    },
    {
      mediaBox: [0, 0, 500, 800],
      cropBox: [50, 100, 450, 700],
      texts: [
        { text: "CROP", x: 70, y: 650 },
        { text: "PARTIAL", x: 40, y: 620 },
        { text: "OUTSIDE", x: -100, y: 620 },
      ],
    },
    {
      mediaBox: [0, 0, 600, 800],
      texts: [
        { text: "ANGLE15", x: 100, y: 700, angle: 15 },
        { text: "ANGLE33.5", x: 220, y: 650, angle: 33.5 },
        { text: "ANGLE359", x: 100, y: 550, angle: 359 },
        { text: "ANGLE1", x: 180, y: 550, angle: 1 },
        { text: "ANGLE3", x: 260, y: 550, angle: 3 },
      ],
    },
    {
      mediaBox: [0, 0, 600, 800],
      texts: [
        { text: "VALID", x: 100, y: 700 },
        { text: "   ", x: 100, y: 650 },
      ],
    },
    {
      mediaBox: [0, 0, 600, 800],
      vectorOnly: true,
    },
  ];
}

export function createDrawingLayoutPdfFixture(): Uint8Array {
  const pages = fixturePages();
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
    "<< /Type /Font /Subtype /Type0 /BaseFont /VoltAiLayoutFixture /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 5 0 R >>",
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /VoltAiLayoutFixture /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /CIDToGIDMap /Identity /DW 1000 >>",
    stream(toUnicode),
    ...pages.map((page, index) => {
      const cropBox = page.cropBox
        ? ` /CropBox [${page.cropBox.join(" ")}]`
        : "";
      const rotation = page.rotation ? ` /Rotate ${page.rotation}` : "";

      return `<< /Type /Page /Parent 2 0 R /MediaBox [${page.mediaBox.join(" ")}]${cropBox}${rotation} /Resources << /Font << /F1 3 0 R >> >> /Contents ${firstContentObject + index} 0 R >>`;
    }),
    ...pages.map((page) => {
      const text = (page.texts ?? []).map(textCommand).join("\n");
      const vector = page.vectorOnly ? "100 100 200 120 re S" : "";
      return stream([text, vector].filter(Boolean).join("\n"));
    }),
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
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, "binary"));
}

export function writeDrawingLayoutFixture(
  projectRoot: string,
  relativePath = "docs/drawing-layout.pdf",
): string {
  const absolutePath = join(projectRoot, ...relativePath.split("/"));
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, createDrawingLayoutPdfFixture());
  return absolutePath;
}

export function createLayoutPageInput(
  overrides: Partial<LayoutFixturePageInput> = {},
): LayoutFixturePageInput {
  return {
    page: 1,
    pageWidth: 600,
    pageHeight: 800,
    cropBox: { x: 0, y: 0, width: 600, height: 800 },
    rotation: 0,
    viewportTransform: [1, 0, 0, -1, 0, 800],
    items: [],
    ...overrides,
  };
}

export function createLayoutTextItem(
  overrides: Partial<LayoutFixtureTextItem> = {},
): LayoutFixtureTextItem {
  return {
    str: "MCCB",
    transform: [12, 0, 0, 12, 100, 700],
    width: 40,
    height: 12,
    fontName: "FixtureFont",
    dir: "ltr",
    hasEOL: false,
    ...overrides,
  };
}

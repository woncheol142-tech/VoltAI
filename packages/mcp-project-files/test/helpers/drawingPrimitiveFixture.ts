import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type PdfPage = {
  mediaBox?: readonly [number, number, number, number];
  cropBox?: readonly [number, number, number, number];
  rotation?: 0 | 90 | 180 | 270;
  content: string;
  resources?: string;
};

function stream(content: string, dictionary = ""): string {
  const separator = dictionary.length > 0 ? ` ${dictionary}` : "";
  return `<< /Length ${Buffer.byteLength(content)}${separator} >>\nstream\n${content}\nendstream`;
}

function buildPdf(
  pages: readonly PdfPage[],
  extraObjects: readonly string[],
): Uint8Array {
  const firstPageObject = 3;
  const firstContentObject = firstPageObject + pages.length;
  const firstExtraObject = firstContentObject + pages.length;
  const pageReferences = pages
    .map((_, index) => `${firstPageObject + index} 0 R`)
    .join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageReferences}] /Count ${pages.length} >>`,
    ...pages.map((page, index) => {
      const mediaBox = page.mediaBox ?? [0, 0, 600, 800];
      const cropBox = page.cropBox ? ` /CropBox [${page.cropBox.join(" ")}]` : "";
      const rotation = page.rotation ? ` /Rotate ${page.rotation}` : "";
      const resources = page.resources ? ` /Resources ${page.resources}` : "";
      return `<< /Type /Page /Parent 2 0 R /MediaBox [${mediaBox.join(" ")}]${cropBox}${rotation}${resources} /Contents ${firstContentObject + index} 0 R >>`;
    }),
    ...pages.map(({ content }) => stream(content)),
    ...extraObjects,
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

  if (firstExtraObject !== objects.length - extraObjects.length + 1) {
    throw new Error("fixture object numbering drifted");
  }
  return new Uint8Array(Buffer.from(pdf, "binary"));
}

export function createDrawingPrimitivePdfFixture(): Uint8Array {
  const pages: PdfPage[] = [
    {
      content: [
        "2 w 1 J 2 j 10 M [3 2] 1 d",
        "1 0 0 RG 0 1 0 rg",
        "100 700 m 200 700 l S",
        "100 650 m 150 650 l 175 625 l S",
        "100 600 m 120 650 180 550 200 600 c S",
        "100 520 m 150 520 l 150 470 l h f",
        "100 420 m 140 420 l 140 380 l h",
        "200 420 m 240 420 l 240 380 l h B",
        "300 420 m 340 420 l 340 380 l h f*",
        "300 320 m 340 320 l 340 280 l h B*",
      ].join("\n"),
    },
    {
      resources: `<< /ExtGState << /GS0 ${3 + 10 + 10} 0 R >> >>`,
      content: [
        "0 w 2 J 1 j 7 M [4 1] 2 d",
        "0.2 0.3 0.4 RG 0.8 0.7 0.6 rg",
        "/GS0 gs",
        "q 2 0 0 3 10 20 cm",
        "q 0 1 -1 0 300 0 cm",
        "10 20 m 40 20 l S",
        "Q",
        "60 20 m 90 20 l S",
        "Q",
        "100 100 m 130 100 l S",
      ].join("\n"),
    },
    {
      rotation: 90,
      content: "q 1 0.25 -0.1 1 20 30 cm 100 700 m 200 700 l 220 720 260 680 300 700 c S Q",
    },
    {
      mediaBox: [0, 0, 640, 480],
      rotation: 180,
      content: "80 300 m 180 300 l S",
    },
    {
      mediaBox: [0, 0, 500, 700],
      rotation: 270,
      content: "70 600 m 70 500 l S",
    },
    {
      mediaBox: [0, 0, 500, 800],
      cropBox: [50, 100, 450, 700],
      content: [
        "40 650 m 100 650 l S",
        "-100 620 m -50 620 l S",
        "430 690 m 500 760 l S",
      ].join("\n"),
    },
    {
      content: [
        "50 50 200 200 re W n",
        "75 75 m 300 300 l S",
        "300 300 100 100 re W* n",
        "250 250 m 450 450 l S",
      ].join("\n"),
    },
    {
      resources: `<< /XObject << /Fm1 ${3 + 10 + 10 + 1} 0 R >> >>`,
      content: [
        "q 1 0 0 1 30 40 cm /Fm1 Do Q",
        "400 100 m 450 100 l S",
      ].join("\n"),
    },
    {
      resources: `<< /ExtGState << /GS0 ${3 + 10 + 10} 0 R >> >>`,
      content: [
        "0 w /GS0 gs",
        "100 100 m 100 100 l S",
        "200 200 m 200.5 200 l S",
        "300 300 m 340 300 l S",
        "300 300 m 340 300 l S",
      ].join("\n"),
    },
    {
      content: "BT /F1 12 Tf 72 720 Td (No painted vector paths) Tj ET",
      resources: `<< /Font << /F1 ${3 + 10 + 10 + 2} 0 R >> >>`,
    },
  ];
  const extras = [
    "<< /Type /ExtGState /CA 0 /ca 0 >>",
    stream(
      [
        "q 1.5 0 0 1.5 10 20 cm",
        "10 10 m 60 10 l 60 40 l h S",
        "Q",
      ].join("\n"),
      "/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Matrix [1 0 0 1 5 6] /Resources << >>",
    ),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  return buildPdf(pages, extras);
}

export function writeDrawingPrimitiveFixture(
  projectRoot: string,
  relativePath = "docs/drawing-primitives.pdf",
): string {
  const absolutePath = join(projectRoot, ...relativePath.split("/"));
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, createDrawingPrimitivePdfFixture());
  return absolutePath;
}

export function primitivePageContext(
  overrides: Partial<{
    pageWidth: number;
    pageHeight: number;
    rotation: number;
    cropBox: { x: number; y: number; width: number; height: number };
    viewportTransform: readonly [number, number, number, number, number, number];
  }> = {},
) {
  const pageWidth = overrides.pageWidth ?? 600;
  const pageHeight = overrides.pageHeight ?? 800;
  return {
    pageWidth,
    pageHeight,
    rotation: 0,
    cropBox: overrides.cropBox ?? {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    },
    viewportTransform: overrides.viewportTransform ?? [
      1,
      0,
      0,
      -1,
      0,
      pageHeight,
    ] as const,
    ...overrides,
  };
}

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

import type { VoltAiTool } from "@voltai/mcp-core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { z } from "zod";

import { groupTextLines } from "../drawingLayout/groupTextLines.js";
import { normalizeAngle, roundPoint } from "../drawingLayout/geometry.js";
import { normalizePageItems } from "../drawingLayout/normalizePageItems.js";
import type {
  DrawingLayoutDocument,
  DrawingLayoutPageInput,
  PdfTextItemLike,
} from "../drawingLayout/types.js";
import { writeDrawingLayout } from "../drawingLayout/writeDrawingLayout.js";
import {
  assertAllowedRelativePath,
  assertProjectRoot,
  resolveProjectFile,
} from "../projectPath.js";

export type ExtractDrawingLayoutInput = {
  relativePath: string;
  page: number;
  outputName?: string;
};

export type ExtractDrawingLayoutResult = DrawingLayoutDocument;

const INPUT_FIELDS = new Set(["relativePath", "page", "outputName"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateInput(input: unknown): ExtractDrawingLayoutInput {
  if (!isRecord(input)) {
    throw new Error("relativePath and page are required");
  }

  const unsupportedField = Object.keys(input).find((field) => !INPUT_FIELDS.has(field));
  if (unsupportedField) {
    throw new Error(`extract_drawing_layout input contains unsupported field: ${unsupportedField}`);
  }
  if (typeof input.relativePath !== "string" || input.relativePath.length === 0) {
    throw new Error("relativePath is required");
  }
  if (input.page === undefined) {
    throw new Error("page is required");
  }
  if (!Number.isInteger(input.page)) {
    throw new Error("page must be an integer");
  }
  if ((input.page as number) < 1) {
    throw new Error("page must be a positive integer");
  }
  if (input.outputName !== undefined && typeof input.outputName !== "string") {
    throw new Error("outputName must be a string");
  }

  return {
    relativePath: input.relativePath,
    page: input.page as number,
    ...(input.outputName === undefined ? {} : { outputName: input.outputName }),
  };
}

function toPdfTextItem(value: unknown, sourceOrder: number): PdfTextItemLike | null {
  if (!isRecord(value) || !("str" in value)) {
    return null;
  }

  const text = value.str;
  if (typeof text !== "string") {
    return null;
  }

  return {
    str: text,
    transform: Array.isArray(value.transform) ? [...value.transform] as number[] : [],
    width: typeof value.width === "number" ? value.width : Number.NaN,
    height: typeof value.height === "number" ? value.height : Number.NaN,
    ...(typeof value.fontName === "string" ? { fontName: value.fontName } : {}),
    ...(typeof value.dir === "string" ? { dir: value.dir } : {}),
    ...(typeof value.hasEOL === "boolean" ? { hasEOL: value.hasEOL } : {}),
    sourceOrder,
  };
}

function pageInput(
  pageNumber: number,
  pdfPage: {
    rotate: number;
    view: readonly number[];
    getViewport(options: { scale: number; rotation: number }): {
      width: number;
      height: number;
      transform: readonly number[];
    };
  },
  rawItems: readonly unknown[],
): DrawingLayoutPageInput {
  const viewport = pdfPage.getViewport({ scale: 1, rotation: pdfPage.rotate });
  const [left = 0, bottom = 0, right = 0, top = 0] = pdfPage.view;

  return {
    page: pageNumber,
    pageWidth: roundPoint(viewport.width),
    pageHeight: roundPoint(viewport.height),
    cropBox: {
      x: roundPoint(Math.min(left, right)),
      y: roundPoint(Math.min(bottom, top)),
      width: roundPoint(Math.abs(right - left)),
      height: roundPoint(Math.abs(top - bottom)),
    },
    rotation: normalizeAngle(pdfPage.rotate),
    viewportTransform: [...viewport.transform],
    items: rawItems
      .map((item, sourceOrder) => toPdfTextItem(item, sourceOrder))
      .filter((item): item is PdfTextItemLike => item !== null),
  };
}

export async function extractDrawingLayout(
  projectRoot: string | undefined,
  input: unknown,
): Promise<ExtractDrawingLayoutResult> {
  const options = validateInput(input);
  assertAllowedRelativePath(options.relativePath);
  if (extname(options.relativePath).toLowerCase() !== ".pdf") {
    throw new Error("Only .pdf files are supported");
  }
  const root = assertProjectRoot(projectRoot);

  const absolutePath = resolveProjectFile(
    root,
    options.relativePath,
    "PDF file does not exist",
  );
  const sourceBytes = readFileSync(absolutePath);
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const loadingTask = getDocument({
    data: new Uint8Array(sourceBytes),
    disableFontFace: true,
    useSystemFonts: true,
  });
  let document: Awaited<typeof loadingTask.promise> | undefined;
  let pdfPage: Awaited<ReturnType<Awaited<typeof loadingTask.promise>["getPage"]>> | undefined;

  try {
    document = await loadingTask.promise;
    if (options.page > document.numPages) {
      throw new Error(`page must be between 1 and ${document.numPages}`);
    }

    pdfPage = await document.getPage(options.page);
    const content = await pdfPage.getTextContent();
    const normalized = normalizePageItems(pageInput(options.page, pdfPage, content.items));
    const lines = groupTextLines(normalized.items);
    const viewport = pdfPage.getViewport({ scale: 1, rotation: pdfPage.rotate });
    const [left = 0, bottom = 0, right = 0, top = 0] = pdfPage.view;
    const result: DrawingLayoutDocument = {
      schemaVersion: 1,
      source: options.relativePath,
      sourceSha256,
      page: options.page,
      pageCount: document.numPages,
      pageWidth: roundPoint(viewport.width),
      pageHeight: roundPoint(viewport.height),
      rotation: normalizeAngle(pdfPage.rotate),
      cropBox: {
        x: roundPoint(Math.min(left, right)),
        y: roundPoint(Math.min(bottom, top)),
        width: roundPoint(Math.abs(right - left)),
        height: roundPoint(Math.abs(top - bottom)),
      },
      coordinateSystem: "normalized-top-left",
      itemCount: normalized.itemCount,
      lineCount: lines.length,
      items: normalized.items,
      lines,
      warnings: normalized.warnings,
    };

    if (options.outputName !== undefined) {
      result.relativeLayoutPath = writeDrawingLayout(root, result, options.outputName);
    }

    return result;
  } finally {
    try {
      pdfPage?.cleanup?.();
    } finally {
      try {
        await document?.cleanup();
      } finally {
        try {
          const destroy = (
            document as { destroy?: () => Promise<void> } | undefined
          )?.destroy;
          await destroy?.call(document);
        } finally {
          await loadingTask.destroy();
        }
      }
    }
  }
}

export function createExtractDrawingLayoutTool(): VoltAiTool<ExtractDrawingLayoutResult> {
  return {
    name: "extract_drawing_layout",
    description:
      "Extract normalized text items and rotation-aware text lines from one PDF drawing page.",
    inputSchema: {
      relativePath: z.string().min(1),
      page: z.number().int().positive(),
      outputName: z.string().optional(),
    },
    handler: async (input) => extractDrawingLayout(process.env.PROJECT_ROOT, input),
  };
}

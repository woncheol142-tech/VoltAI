import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

import type { VoltAiTool } from "@voltai/mcp-core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { z } from "zod";

import { buildDrawingPageMap } from "../drawingPageMap/buildDrawingPageMap.js";
import { parseDrawingPage } from "../drawingPageMap/parseDrawingPage.js";
import type {
  DrawingPageMapDocument,
  DrawingPageScanResult,
  DrawingPageTextItem,
} from "../drawingPageMap/types.js";
import { writeDrawingPageMap } from "../drawingPageMap/writeDrawingPageMap.js";
import { loadDrawingIndex } from "../drawingSearch/loadDrawingIndex.js";
import {
  assertAllowedRelativePath,
  assertProjectRoot,
  resolveProjectFile,
} from "../projectPath.js";

export type MapDrawingPagesInput = {
  relativePath: string;
  indexPath: string;
  startPage?: number;
  endPage?: number;
  outputName?: string;
};

export type MapDrawingPagesResult = DrawingPageMapDocument;

type PdfPage = {
  rotate: number;
  view: readonly number[];
  getTextContent(): Promise<{ items: unknown[] }>;
  cleanup?(): void;
};

const INPUT_FIELDS = new Set(["relativePath", "indexPath", "startPage", "endPage", "outputName"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} is required`);
  return value;
}

function validateInput(input: unknown): MapDrawingPagesInput {
  if (!isRecord(input)) throw new Error("relativePath and indexPath are required");
  const unknown = Object.keys(input).find((field) => !INPUT_FIELDS.has(field));
  if (unknown) throw new Error(`map_drawing_pages input contains unsupported field: ${unknown}`);
  for (const field of ["startPage", "endPage"] as const) {
    if (input[field] !== undefined && !Number.isInteger(input[field])) {
      throw new Error(`${field} must be an integer`);
    }
  }
  if (input.startPage !== undefined && (input.startPage as number) < 1) {
    throw new Error("startPage must be a positive integer");
  }
  if (input.outputName !== undefined && typeof input.outputName !== "string") {
    throw new Error("outputName must be a string");
  }
  return {
    relativePath: requiredString(input.relativePath, "relativePath"),
    indexPath: requiredString(input.indexPath, "indexPath"),
    ...(input.startPage === undefined ? {} : { startPage: input.startPage as number }),
    ...(input.endPage === undefined ? {} : { endPage: input.endPage as number }),
    ...(input.outputName === undefined ? {} : { outputName: input.outputName }),
  };
}

function normalizePath(value: string): string {
  return value.normalize("NFKC").replaceAll("\\", "/");
}

function isPdfItem(item: unknown): item is {
  str: string;
  transform: number[];
  width: number;
  height: number;
} {
  return (
    isRecord(item) && typeof item.str === "string" && Array.isArray(item.transform) &&
    item.transform.length === 6 && item.transform.every((value) => typeof value === "number") &&
    typeof item.width === "number" && typeof item.height === "number"
  );
}

function toTextItem(item: unknown): DrawingPageTextItem | null {
  if (!isPdfItem(item)) return null;
  return {
    str: item.str,
    transform: [
      item.transform[0]!, item.transform[1]!, item.transform[2]!,
      item.transform[3]!, item.transform[4]!, item.transform[5]!,
    ],
    width: item.width,
    height: item.height,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function mapDrawingPages(
  projectRoot: string | undefined,
  input: unknown,
): Promise<MapDrawingPagesResult> {
  const root = assertProjectRoot(projectRoot);
  const options = validateInput(input);
  assertAllowedRelativePath(options.relativePath);
  if (extname(options.relativePath).toLowerCase() !== ".pdf") {
    throw new Error("Only .pdf files are supported");
  }
  const absolutePath = resolveProjectFile(root, options.relativePath, "PDF file does not exist");
  const index = loadDrawingIndex(root, options.indexPath);
  if (index.drawings.length === 0) throw new Error("Drawing index has no drawings (empty index)");
  if (normalizePath(index.source) !== normalizePath(options.relativePath)) {
    throw new Error("Drawing index source path mismatch");
  }

  const sourceBytes = readFileSync(absolutePath);
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  if (index.sourceSha256 !== sourceSha256) throw new Error("Drawing index source SHA-256 mismatch");

  const loadingTask = getDocument({
    data: new Uint8Array(sourceBytes),
    disableFontFace: true,
    useSystemFonts: true,
  });
  let document: Awaited<typeof loadingTask.promise> | undefined;
  try {
    document = await loadingTask.promise;
    const startPage = options.startPage ?? index.endPage + 1;
    const endPage = options.endPage ?? document.numPages;
    if (startPage > document.numPages) {
      throw new Error(`startPage must not exceed the PDF page count of ${document.numPages}`);
    }
    if (endPage < startPage) throw new Error("endPage must be greater than or equal to startPage");
    if (endPage > document.numPages) {
      throw new Error(`endPage must be between 1 and ${document.numPages}`);
    }

    const pageResults: DrawingPageScanResult[] = [];
    for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
      let page: PdfPage | undefined;
      try {
        page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const width = Math.abs(page.view[2] - page.view[0]);
        const height = Math.abs(page.view[3] - page.view[1]);
        const parsed = parseDrawingPage(
          {
            page: pageNumber,
            width,
            height,
            rotation: page.rotate,
            originX: page.view[0],
            originY: page.view[1],
            items: content.items
              .map((item: unknown) => toTextItem(item))
              .filter((item): item is DrawingPageTextItem => item !== null),
          },
          index.drawings,
        );
        pageResults.push({ page: pageNumber, status: "processed", mapping: parsed.mapping, warnings: parsed.warnings });
      } catch (error) {
        pageResults.push({ page: pageNumber, status: "failed", message: errorMessage(error) });
      } finally {
        page?.cleanup?.();
      }
    }

    const result = buildDrawingPageMap({
      index,
      indexPath: options.indexPath,
      source: options.relativePath,
      sourceSha256,
      startPage,
      endPage,
      pageResults,
    });
    if (options.outputName !== undefined) {
      result.relativePageMapPath = writeDrawingPageMap(root, result, options.outputName);
    }
    return result;
  } finally {
    try {
      await document?.cleanup();
      const destroy = (document as { destroy?: () => Promise<void> } | undefined)?.destroy;
      await destroy?.call(document);
    } finally {
      await loadingTask.destroy();
    }
  }
}

export function createMapDrawingPagesTool(): VoltAiTool<MapDrawingPagesResult> {
  return {
    name: "map_drawing_pages",
    description: "Map Task 40 drawing index numbers to PDF drawing pages using title-block coordinates.",
    inputSchema: {
      relativePath: z.string().min(1),
      indexPath: z.string().min(1),
      startPage: z.number().int().positive().optional(),
      endPage: z.number().int().positive().optional(),
      outputName: z.string().optional(),
    },
    handler: async (input) => mapDrawingPages(process.env.PROJECT_ROOT, input),
  };
}

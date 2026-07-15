import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

import type { VoltAiTool } from "@voltai/mcp-core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { z } from "zod";

import { parseDrawingListPages } from "../drawingIndex/parseDrawingList.js";
import type {
  DrawingIndexDocument,
  DrawingListTextItem,
  DrawingListTextPage,
} from "../drawingIndex/types.js";
import { writeDrawingIndex } from "../drawingIndex/writeDrawingIndex.js";
import {
  assertAllowedRelativePath,
  assertProjectRoot,
  resolveProjectFile,
} from "../projectPath.js";

export type IndexDrawingListInput = {
  relativePath: string;
  startPage: number;
  endPage: number;
  outputName?: string;
};

export type IndexDrawingListResult = DrawingIndexDocument;

function assertIndexDrawingListInput(input: unknown): IndexDrawingListInput {
  if (!input || typeof input !== "object") {
    throw new Error("relativePath is required");
  }

  const candidate = input as Partial<IndexDrawingListInput>;
  if (typeof candidate.relativePath !== "string" || candidate.relativePath.length === 0) {
    throw new Error("relativePath is required");
  }
  if (!Number.isInteger(candidate.startPage) || (candidate.startPage ?? 0) < 1) {
    throw new Error("startPage must be a positive integer");
  }
  if (!Number.isInteger(candidate.endPage)) {
    throw new Error("endPage must be an integer");
  }
  if ((candidate.endPage as number) < (candidate.startPage as number)) {
    throw new Error("endPage must be greater than or equal to startPage");
  }
  if (candidate.outputName !== undefined && typeof candidate.outputName !== "string") {
    throw new Error("outputName must be a string");
  }

  return {
    relativePath: candidate.relativePath,
    startPage: candidate.startPage as number,
    endPage: candidate.endPage as number,
    outputName: candidate.outputName,
  };
}

function assertPdfPath(relativePath: string): void {
  assertAllowedRelativePath(relativePath);

  if (extname(relativePath).toLowerCase() !== ".pdf") {
    throw new Error("Only .pdf files are supported");
  }
}

function isPdfTextItem(item: unknown): item is {
  str: string;
  transform: number[];
  width: number;
  height: number;
} {
  return (
    typeof item === "object" &&
    item !== null &&
    "str" in item &&
    typeof item.str === "string" &&
    "transform" in item &&
    Array.isArray(item.transform) &&
    item.transform.length === 6 &&
    item.transform.every((value) => typeof value === "number") &&
    "width" in item &&
    typeof item.width === "number" &&
    "height" in item &&
    typeof item.height === "number"
  );
}

function toDrawingTextItem(item: unknown): DrawingListTextItem | null {
  if (!isPdfTextItem(item)) {
    return null;
  }

  return {
    str: item.str,
    transform: [
      item.transform[0],
      item.transform[1],
      item.transform[2],
      item.transform[3],
      item.transform[4],
      item.transform[5],
    ],
    width: item.width,
    height: item.height,
  };
}

export async function indexDrawingList(
  projectRoot: string | undefined,
  input: unknown,
): Promise<IndexDrawingListResult> {
  const root = assertProjectRoot(projectRoot);
  const { relativePath, startPage, endPage, outputName } =
    assertIndexDrawingListInput(input);
  assertPdfPath(relativePath);

  const absolutePath = resolveProjectFile(root, relativePath, "PDF file does not exist");
  const sourceBytes = readFileSync(absolutePath);
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const loadingTask = getDocument({
    data: new Uint8Array(sourceBytes),
    disableFontFace: true,
    useSystemFonts: true,
  });
  let document: Awaited<typeof loadingTask.promise> | undefined;

  try {
    document = await loadingTask.promise;
    if (endPage > document.numPages) {
      throw new Error(`endPage must be between 1 and ${document.numPages}`);
    }

    const pages: DrawingListTextPage[] = [];
    for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
      const page = await document.getPage(pageNumber);

      try {
        const content = await page.getTextContent();
        pages.push({
          page: pageNumber,
          items: content.items
            .map(toDrawingTextItem)
            .filter((item): item is DrawingListTextItem => item !== null),
        });
      } finally {
        page.cleanup?.();
      }
    }

    const parsed = parseDrawingListPages(pages);
    const result: IndexDrawingListResult = {
      schemaVersion: 1,
      source: relativePath,
      sourceSha256,
      startPage,
      endPage,
      drawingCount: parsed.drawings.length,
      drawings: parsed.drawings,
      warnings: parsed.warnings,
    };

    if (outputName !== undefined) {
      result.relativeIndexPath = writeDrawingIndex(root, result, outputName);
    }

    return result;
  } finally {
    try {
      await document?.cleanup();
    } finally {
      await loadingTask.destroy();
    }
  }
}

export function createIndexDrawingListTool(): VoltAiTool<IndexDrawingListResult> {
  return {
    name: "index_drawing_list",
    description:
      "Parse coordinate-based PDF drawing-list tables into a structured drawing index.",
    inputSchema: {
      relativePath: z.string().min(1),
      startPage: z.number().int().positive(),
      endPage: z.number().int().positive(),
      outputName: z.string().optional(),
    },
    handler: async (input) => indexDrawingList(process.env.PROJECT_ROOT, input),
  };
}

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

import type { VoltAiTool } from "@voltai/mcp-core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { z } from "zod";

import { decodeOperatorList } from "../drawingPrimitive/decodeOperatorList.js";
import type { DrawingPrimitiveDocument } from "../drawingPrimitive/types.js";
import { writeDrawingPrimitives } from "../drawingPrimitive/writeDrawingPrimitives.js";
import {
  assertAllowedRelativePath,
  assertProjectRoot,
  resolveProjectFile,
} from "../projectPath.js";

export type ExtractDrawingPrimitivesInput = {
  relativePath: string;
  page: number;
  outputName?: string;
};

export type ExtractDrawingPrimitivesResult = DrawingPrimitiveDocument;

const INPUT_FIELDS = new Set(["relativePath", "page", "outputName"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateInput(input: unknown): ExtractDrawingPrimitivesInput {
  if (!isRecord(input)) {
    throw new Error("relativePath and page are required");
  }
  const unsupported = Object.keys(input).find((field) => !INPUT_FIELDS.has(field));
  if (unsupported) {
    throw new Error(
      `extract_drawing_primitives input contains unsupported field: ${unsupported}`,
    );
  }
  if (typeof input.relativePath !== "string" || input.relativePath.length === 0) {
    throw new Error("relativePath is required");
  }
  if (input.page === undefined) throw new Error("page is required");
  if (!Number.isInteger(input.page)) throw new Error("page must be an integer");
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

function round(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("PDF page metadata must contain finite numbers");
  }
  const result = Number(value.toFixed(3));
  return Object.is(result, -0) ? 0 : result;
}

function normalizeRotation(value: number): number {
  if (!Number.isFinite(value)) throw new Error("PDF page rotation must be finite");
  const normalized = ((value % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(normalized)) {
    throw new Error("PDF page rotation must be 0, 90, 180, or 270");
  }
  return normalized;
}

export async function extractDrawingPrimitives(
  projectRoot: string | undefined,
  input: unknown,
): Promise<ExtractDrawingPrimitivesResult> {
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
    data: new Uint8Array(
      sourceBytes.buffer,
      sourceBytes.byteOffset,
      sourceBytes.byteLength,
    ),
    disableFontFace: true,
    useSystemFonts: true,
  });
  let document: Awaited<typeof loadingTask.promise> | undefined;
  let pdfPage:
    | Awaited<ReturnType<Awaited<typeof loadingTask.promise>["getPage"]>>
    | undefined;

  try {
    document = await loadingTask.promise;
    if (options.page > document.numPages) {
      throw new Error(`page must be between 1 and ${document.numPages}`);
    }
    pdfPage = await document.getPage(options.page);
    const rotation = normalizeRotation(pdfPage.rotate);
    const viewport = pdfPage.getViewport({ scale: 1, rotation });
    const [left = 0, bottom = 0, right = 0, top = 0] = pdfPage.view;
    const pageWidth = round(viewport.width);
    const pageHeight = round(viewport.height);
    const decoded = decodeOperatorList(await pdfPage.getOperatorList(), {
      pageWidth,
      pageHeight,
      rotation,
      cropBox: {
        x: round(Math.min(left, right)),
        y: round(Math.min(bottom, top)),
        width: round(Math.abs(right - left)),
        height: round(Math.abs(top - bottom)),
      },
      viewportTransform: [...viewport.transform] as [
        number,
        number,
        number,
        number,
        number,
        number,
      ],
    });
    const result: DrawingPrimitiveDocument = {
      schemaVersion: 1,
      source: options.relativePath,
      sourceSha256,
      page: options.page,
      pageCount: document.numPages,
      pageWidth,
      pageHeight,
      rotation,
      cropBox: {
        x: round(Math.min(left, right)),
        y: round(Math.min(bottom, top)),
        width: round(Math.abs(right - left)),
        height: round(Math.abs(top - bottom)),
      },
      coordinateSystem: "normalized-top-left",
      primitiveCount: decoded.primitives.length,
      primitives: decoded.primitives,
      warnings: decoded.warnings,
    };
    if (options.outputName !== undefined) {
      result.relativePrimitivePath = writeDrawingPrimitives(
        root,
        result,
        options.outputName,
      );
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

export function createExtractDrawingPrimitivesTool(): VoltAiTool<ExtractDrawingPrimitivesResult> {
  return {
    name: "extract_drawing_primitives",
    description:
      "Extract painted PDF vector paths with graphics state and visual page geometry.",
    inputSchema: {
      relativePath: z.string().min(1),
      page: z.number().int().positive(),
      outputName: z.string().optional(),
    },
    handler: async (input) =>
      extractDrawingPrimitives(process.env.PROJECT_ROOT, input),
  };
}

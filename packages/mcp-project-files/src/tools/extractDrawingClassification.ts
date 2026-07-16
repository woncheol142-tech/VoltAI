import type { VoltAiTool } from "@voltai/mcp-core";
import { z } from "zod";

import { classifyDrawingPrimitives } from "../drawingClassification/classifyDrawingPrimitives.js";
import type { DrawingPrimitiveClassificationDocument } from "../drawingClassification/types.js";
import { writeDrawingClassification } from "../drawingClassification/writeDrawingClassification.js";
import { extractDrawingPrimitives } from "./extractDrawingPrimitives.js";

export type ExtractDrawingClassificationInput = {
  relativePath: string;
  page: number;
  outputName?: string;
};

export type ExtractDrawingClassificationResult =
  DrawingPrimitiveClassificationDocument;

const INPUT_FIELDS = new Set(["relativePath", "page", "outputName"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateInput(input: unknown): ExtractDrawingClassificationInput {
  if (!isRecord(input)) {
    throw new Error("relativePath and page are required");
  }
  const unsupported = Object.keys(input).find((field) => !INPUT_FIELDS.has(field));
  if (unsupported) {
    throw new Error(
      `extract_drawing_classification input contains unsupported field: ${unsupported}`,
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

export async function extractDrawingClassification(
  projectRoot: string | undefined,
  input: unknown,
): Promise<ExtractDrawingClassificationResult> {
  const options = validateInput(input);
  const primitiveDocument = await extractDrawingPrimitives(projectRoot, {
    relativePath: options.relativePath,
    page: options.page,
  });
  const result = classifyDrawingPrimitives(primitiveDocument);
  if (options.outputName !== undefined) {
    writeDrawingClassification(projectRoot!, result, options.outputName);
  }
  return result;
}

export function createExtractDrawingClassificationTool(): VoltAiTool<ExtractDrawingClassificationResult> {
  return {
    name: "extract_drawing_classification",
    description:
      "Derive deterministic structural classifications from painted PDF primitives.",
    inputSchema: {
      relativePath: z.string().min(1),
      page: z.number().int().positive(),
      outputName: z.string().optional(),
    },
    handler: async (input) =>
      extractDrawingClassification(process.env.PROJECT_ROOT, input),
  };
}

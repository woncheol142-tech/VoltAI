import { lstatSync } from "node:fs";
import { resolve } from "node:path";

import type { VoltAiTool } from "@voltai/mcp-core";
import { z } from "zod";

import { classifyDrawingPrimitives } from "../drawingClassification/classifyDrawingPrimitives.js";
import { buildDrawingSpatialRelations } from "../drawingSpatial/buildDrawingSpatialRelations.js";
import type { DrawingSpatialRelationDocument } from "../drawingSpatial/types.js";
import { writeDrawingSpatialRelations } from "../drawingSpatial/writeDrawingSpatialRelations.js";
import {
  assertAllowedRelativePath,
  assertProjectRoot,
} from "../projectPath.js";
import { extractDrawingLayout } from "./extractDrawingLayout.js";
import { extractDrawingPrimitives } from "./extractDrawingPrimitives.js";

export type ExtractDrawingSpatialRelationsInput = {
  relativePath: string;
  page: number;
  outputName?: string;
};

export type ExtractDrawingSpatialRelationsResult =
  DrawingSpatialRelationDocument & {
    relativeSpatialPath?: string;
  };

const INPUT_FIELDS = new Set(["relativePath", "page", "outputName"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateInput(input: unknown): ExtractDrawingSpatialRelationsInput {
  if (!isRecord(input)) {
    throw new Error("relativePath and page are required");
  }
  const unsupported = Object.keys(input).find((field) => !INPUT_FIELDS.has(field));
  if (unsupported) {
    throw new Error(
      `extract_drawing_spatial_relations input contains unsupported field: ${unsupported}`,
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

export async function extractDrawingSpatialRelations(
  projectRoot: string | undefined,
  input: unknown,
): Promise<ExtractDrawingSpatialRelationsResult> {
  const options = validateInput(input);
  assertAllowedRelativePath(options.relativePath);
  const root = assertProjectRoot(projectRoot);
  try {
    if (lstatSync(resolve(root, options.relativePath)).isSymbolicLink()) {
      throw new Error("Drawing spatial PDF source cannot be a symbolic link");
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Drawing spatial PDF source cannot be a symbolic link"
    ) {
      throw error;
    }
  }
  const extractionInput = {
    relativePath: options.relativePath,
    page: options.page,
  };
  const layout = await extractDrawingLayout(projectRoot, extractionInput);
  const primitive = await extractDrawingPrimitives(projectRoot, extractionInput);
  const classification = classifyDrawingPrimitives(primitive);
  const document = buildDrawingSpatialRelations({
    layout,
    primitive,
    classification,
  });
  if (options.outputName === undefined) return document;

  const relativeSpatialPath = writeDrawingSpatialRelations(
    root,
    document,
    options.outputName,
  );
  return { ...document, relativeSpatialPath };
}

export function createExtractDrawingSpatialRelationsTool(): VoltAiTool<ExtractDrawingSpatialRelationsResult> {
  return {
    name: "extract_drawing_spatial_relations",
    description:
      "Link drawing text items and lines to painted primitives using deterministic page-bbox geometry.",
    inputSchema: {
      relativePath: z.string().min(1),
      page: z.number().int().positive(),
      outputName: z.string().optional(),
    },
    handler: async (input) =>
      extractDrawingSpatialRelations(process.env.PROJECT_ROOT, input),
  };
}

import { readFileSync } from "node:fs";
import { extname } from "node:path";

import type { VoltAiTool } from "@voltai/mcp-core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { z } from "zod";

import {
  assertAllowedRelativePath as assertAllowedProjectRelativePath,
  assertProjectRoot,
  resolveProjectFile,
} from "../projectPath.js";

export type ReadPdfInput = {
  relativePath: string;
  maxChars?: number;
};

export type ReadPdfResult = {
  relativePath: string;
  pageCount: number;
  text: string;
};

function assertReadPdfInput(input: unknown): ReadPdfInput {
  if (!input || typeof input !== "object") {
    throw new Error("relativePath is required");
  }

  const candidate = input as Partial<ReadPdfInput>;

  if (typeof candidate.relativePath !== "string" || candidate.relativePath.length === 0) {
    throw new Error("relativePath is required");
  }

  if (
    candidate.maxChars !== undefined &&
    (!Number.isInteger(candidate.maxChars) || candidate.maxChars < 1)
  ) {
    throw new Error("maxChars must be a positive integer");
  }

  return {
    relativePath: candidate.relativePath,
    maxChars: candidate.maxChars,
  };
}

function assertAllowedRelativePath(relativePath: string): void {
  assertAllowedProjectRelativePath(relativePath);

  if (extname(relativePath).toLowerCase() !== ".pdf") {
    throw new Error("Only .pdf files are supported");
  }
}

function appendWithLimit(current: string, addition: string, maxChars?: number): string {
  const next = current.length === 0 ? addition : `${current}\n${addition}`;

  if (maxChars === undefined) {
    return next;
  }

  return next.slice(0, maxChars);
}

function hasTextString(item: unknown): item is { str: string } {
  return (
    typeof item === "object" &&
    item !== null &&
    "str" in item &&
    typeof item.str === "string"
  );
}

export async function readPdf(
  projectRoot: string | undefined,
  input: unknown,
): Promise<ReadPdfResult> {
  const root = assertProjectRoot(projectRoot);
  const { relativePath, maxChars } = assertReadPdfInput(input);

  assertAllowedRelativePath(relativePath);

  const absolutePath = resolveProjectFile(root, relativePath, "PDF file does not exist");
  const data = new Uint8Array(readFileSync(absolutePath));
  const loadingTask = getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  let text = "";

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (maxChars !== undefined && text.length >= maxChars) {
        break;
      }

      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => (hasTextString(item) ? item.str : ""))
        .filter((textItem) => textItem.length > 0)
        .join(" ")
        .trim();

      if (pageText.length > 0) {
        text = appendWithLimit(text, pageText, maxChars);
      }
    }
  } finally {
    await document.cleanup();
    await loadingTask.destroy();
  }

  const normalizedText = text.trim();

  if (normalizedText.length === 0) {
    throw new Error("PDF text is empty or unavailable");
  }

  return {
    relativePath,
    pageCount: document.numPages,
    text: normalizedText,
  };
}

export function createReadPdfTool(): VoltAiTool {
  return {
    name: "read_pdf",
    description: "Read text from a PDF under PROJECT_ROOT.",
    inputSchema: {
      relativePath: z.string().min(1),
      maxChars: z.number().int().positive().optional(),
    },
    handler: async (input) => JSON.stringify(await readPdf(process.env.PROJECT_ROOT, input)),
  };
}

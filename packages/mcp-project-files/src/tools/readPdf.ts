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
  pages: Array<{
    page: number;
    text: string;
    charCount: number;
  }>;
  truncated: boolean;
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
  let document: Awaited<typeof loadingTask.promise> | undefined;

  try {
    document = await loadingTask.promise;
    let truncated = false;
    const pages: ReadPdfResult["pages"] = [];
    let aggregateLength = 0;

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      let pageText = "";

      try {
        const content = await page.getTextContent();
        pageText = content.items
          .map((item) => (hasTextString(item) ? item.str : ""))
          .filter((textItem) => textItem.length > 0)
          .join(" ")
          .trim();
      } finally {
        page.cleanup?.();
      }

      if (pageText.length === 0) {
        continue;
      }

      const separatorLength = pages.length === 0 ? 0 : 1;
      const availablePageChars =
        maxChars === undefined
          ? pageText.length
          : maxChars - aggregateLength - separatorLength;

      if (availablePageChars <= 0) {
        truncated = true;
        break;
      }

      const includedPageText = pageText.slice(0, availablePageChars).trim();

      if (includedPageText.length > 0) {
        pages.push({
          page: pageNumber,
          text: includedPageText,
          charCount: includedPageText.length,
        });
        aggregateLength += separatorLength + includedPageText.length;
      }

      if (includedPageText.length < pageText.length) {
        truncated = true;
        break;
      }
    }

    const text = pages.map((page) => page.text).join("\n");

    if (text.length === 0) {
      throw new Error("PDF text is empty or unavailable");
    }

    return {
      relativePath,
      pageCount: document.numPages,
      text,
      pages,
      truncated,
    };
  } finally {
    try {
      await document?.cleanup();
    } finally {
      await loadingTask.destroy();
    }
  }
}

export function createReadPdfTool(): VoltAiTool<ReadPdfResult> {
  return {
    name: "read_pdf",
    description: "Read text from a PDF under PROJECT_ROOT.",
    inputSchema: {
      relativePath: z.string().min(1),
      maxChars: z.number().int().positive().optional(),
    },
    handler: async (input) => readPdf(process.env.PROJECT_ROOT, input),
  };
}

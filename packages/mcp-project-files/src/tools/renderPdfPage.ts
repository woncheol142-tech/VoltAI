import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, posix } from "node:path";
import { randomUUID } from "node:crypto";

import type { Canvas } from "@napi-rs/canvas";
import type { VoltAiTool } from "@voltai/mcp-core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { z } from "zod";

import {
  assertAllowedRelativePath as assertAllowedProjectRelativePath,
  assertProjectRoot,
  isWithinProjectRoot,
  resolveProjectFile,
} from "../projectPath.js";

export type RenderPdfPageInput = {
  relativePath: string;
  page: number;
  scale?: number;
  format?: "png" | "jpeg";
};

export type RenderPdfPageResult = {
  page: number;
  pageCount: number;
  width: number;
  height: number;
  format: "png" | "jpeg";
  relativeImagePath: string;
  mimeType: "image/png" | "image/jpeg";
};

type PdfJsCanvasContainer = {
  canvas: Canvas | null;
  context: unknown;
};

type PdfJsCanvasFactory = {
  create(width: number, height: number): PdfJsCanvasContainer;
  destroy(container: PdfJsCanvasContainer): void;
};

function assertRenderPdfPageInput(input: unknown): Required<RenderPdfPageInput> {
  if (!input || typeof input !== "object") {
    throw new Error("relativePath is required");
  }

  const candidate = input as Partial<RenderPdfPageInput>;

  if (typeof candidate.relativePath !== "string" || candidate.relativePath.length === 0) {
    throw new Error("relativePath is required");
  }

  if (!Number.isInteger(candidate.page) || (candidate.page ?? 0) < 1) {
    throw new Error("page must be a positive integer");
  }

  const scale = candidate.scale ?? 2;
  if (!Number.isFinite(scale) || scale < 1 || scale > 4) {
    throw new Error("scale must be between 1 and 4");
  }

  const format = candidate.format ?? "png";
  if (format !== "png" && format !== "jpeg") {
    throw new Error("format must be png or jpeg");
  }

  return {
    relativePath: candidate.relativePath,
    page: candidate.page as number,
    scale,
    format,
  };
}

function assertPdfRelativePath(relativePath: string): void {
  assertAllowedProjectRelativePath(relativePath);

  if (extname(relativePath).toLowerCase() !== ".pdf") {
    throw new Error("Only .pdf files are supported");
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function ensureSecureOutputDirectory(projectRoot: string, pathParts: string[]): string {
  let currentPath = projectRoot;

  for (const pathPart of pathParts) {
    currentPath = join(currentPath, pathPart);

    try {
      const stats = lstatSync(currentPath);

      if (stats.isSymbolicLink()) {
        throw new Error("Rendered output path cannot include symbolic links");
      }

      if (!stats.isDirectory()) {
        throw new Error("Rendered output path must contain directories only");
      }
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }

      mkdirSync(currentPath);
    }

    const realDirectory = realpathSync(currentPath);
    if (!isWithinProjectRoot(projectRoot, realDirectory)) {
      throw new Error("Rendered output path cannot include symbolic links");
    }
  }

  return currentPath;
}

function sanitizeFileStem(fileStem: string): string {
  const sanitized = fileStem
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, "_")
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, "_")
    .replace(/^_+|_+$/gu, "");

  return sanitized.length > 0 ? sanitized : "document";
}

function createOutputTarget(
  projectRoot: string,
  relativePath: string,
  page: number,
  scale: number,
  format: "png" | "jpeg",
): { absolutePath: string; relativePath: string } {
  const normalizedSourcePath = relativePath.replaceAll("\\", "/");
  const sourceDirectory = posix.dirname(normalizedSourcePath);
  const sourceDirectoryParts = sourceDirectory === "." ? [] : sourceDirectory.split("/");
  const outputDirectoryParts = [".volt-ai", "rendered", ...sourceDirectoryParts];
  const outputDirectory = ensureSecureOutputDirectory(projectRoot, outputDirectoryParts);
  const sourceStem = basename(posix.basename(normalizedSourcePath), extname(normalizedSourcePath));
  const fileName = `${sanitizeFileStem(sourceStem)}-page-${String(page).padStart(3, "0")}-scale-${String(scale)}.${format}`;
  const relativeOutputPath = posix.join(...outputDirectoryParts, fileName);

  return {
    absolutePath: join(outputDirectory, fileName),
    relativePath: relativeOutputPath,
  };
}

function writeImageAtomically(absolutePath: string, image: Buffer): void {
  const outputDirectory = dirname(absolutePath);
  const temporaryPath = join(outputDirectory, `.${basename(absolutePath)}.${randomUUID()}.tmp`);

  try {
    writeFileSync(temporaryPath, image, { flag: "wx", mode: 0o600 });

    try {
      const existing = lstatSync(absolutePath);
      if (existing.isSymbolicLink()) {
        throw new Error("Rendered output path cannot include symbolic links");
      }
      if (!existing.isFile()) {
        throw new Error("Rendered output path must be a file");
      }
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }

    renameSync(temporaryPath, absolutePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export async function renderPdfPage(
  projectRoot: string | undefined,
  input: unknown,
): Promise<RenderPdfPageResult> {
  const root = assertProjectRoot(projectRoot);
  const { relativePath, page, scale, format } = assertRenderPdfPageInput(input);

  assertPdfRelativePath(relativePath);

  const absolutePdfPath = resolveProjectFile(root, relativePath, "PDF file does not exist");
  const loadingTask = getDocument({
    data: new Uint8Array(readFileSync(absolutePdfPath)),
    disableFontFace: true,
    useSystemFonts: true,
  });
  let document: Awaited<typeof loadingTask.promise> | undefined;

  try {
    document = await loadingTask.promise;

    if (page > document.numPages) {
      throw new Error(`page must be between 1 and ${document.numPages}`);
    }

    const pdfPage = await document.getPage(page);

    try {
      const viewport = pdfPage.getViewport({ scale });
      const canvasFactory = document.canvasFactory as PdfJsCanvasFactory;
      const canvasContainer = canvasFactory.create(viewport.width, viewport.height);

      try {
        const canvas = canvasContainer.canvas;

        if (!canvas) {
          throw new Error("PDF canvas could not be created");
        }

        await pdfPage.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          viewport,
          background: format === "jpeg" ? "#ffffff" : undefined,
        }).promise;

        const mimeType = format === "png" ? "image/png" : "image/jpeg";
        const outputTarget = createOutputTarget(root, relativePath, page, scale, format);
        const image =
          format === "png" ? canvas.toBuffer("image/png") : canvas.toBuffer("image/jpeg");

        writeImageAtomically(outputTarget.absolutePath, image);

        return {
          page,
          pageCount: document.numPages,
          width: canvas.width,
          height: canvas.height,
          format,
          relativeImagePath: outputTarget.relativePath,
          mimeType,
        };
      } finally {
        canvasFactory.destroy(canvasContainer);
      }
    } finally {
      pdfPage.cleanup?.();
    }
  } finally {
    try {
      await document?.cleanup();
    } finally {
      await loadingTask.destroy();
    }
  }
}

export function createRenderPdfPageTool(): VoltAiTool<RenderPdfPageResult> {
  return {
    name: "render_pdf_page",
    description: "Render one PDF page under PROJECT_ROOT to a PNG or JPEG image.",
    inputSchema: {
      relativePath: z.string().min(1),
      page: z.number().int().positive(),
      scale: z.number().min(1).max(4).optional(),
      format: z.enum(["png", "jpeg"]).optional(),
    },
    handler: async (input) => renderPdfPage(process.env.PROJECT_ROOT, input),
  };
}

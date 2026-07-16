import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, posix } from "node:path";

import { isWithinProjectRoot } from "../projectPath.js";
import type { DrawingPrimitiveDocument } from "./types.js";

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function ensureSecurePrimitiveDirectory(projectRoot: string): string {
  let currentPath = projectRoot;
  for (const part of [".volt-ai", "primitives"]) {
    currentPath = join(currentPath, part);
    try {
      const stats = lstatSync(currentPath);
      if (stats.isSymbolicLink()) {
        throw new Error("Drawing primitive output path cannot include symbolic links");
      }
      if (!stats.isDirectory()) {
        throw new Error("Drawing primitive output path must contain directories only");
      }
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      mkdirSync(currentPath);
    }
    if (!isWithinProjectRoot(projectRoot, realpathSync(currentPath))) {
      throw new Error("Drawing primitive output path cannot include symbolic links");
    }
  }
  return currentPath;
}

function sanitizeOutputName(outputName: string): string {
  const normalized = outputName.normalize("NFKC").trim();
  if (
    normalized.length === 0 ||
    normalized.startsWith(".") ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    normalized.includes("..")
  ) {
    throw new Error("outputName must be a non-hidden logical name without path separators");
  }
  const safeName = normalized
    .replace(/\s+/gu, "_")
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  if (safeName.length === 0 || safeName.startsWith(".")) {
    throw new Error("outputName must contain a safe file name");
  }
  return safeName;
}

function targetPath(
  projectRoot: string,
  document: DrawingPrimitiveDocument,
  outputName: string,
): { absolutePath: string; relativePath: string } {
  const directory = ensureSecurePrimitiveDirectory(projectRoot);
  const sourceHash = createHash("sha256")
    .update(document.source.normalize("NFKC").replaceAll("\\", "/"), "utf8")
    .digest("hex")
    .slice(0, 12);
  const fileName = `${sanitizeOutputName(outputName)}-${sourceHash}-page-${String(document.page).padStart(3, "0")}.json`;
  return {
    absolutePath: join(directory, fileName),
    relativePath: posix.join(".volt-ai", "primitives", fileName),
  };
}

function writeAtomically(absolutePath: string, content: string): void {
  const temporaryPath = join(
    dirname(absolutePath),
    `.${basename(absolutePath)}.${randomUUID()}.tmp`,
  );
  try {
    writeFileSync(temporaryPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    try {
      const existing = lstatSync(absolutePath);
      if (existing.isSymbolicLink()) {
        throw new Error("Drawing primitive output path cannot include symbolic links");
      }
      if (!existing.isFile()) {
        throw new Error("Drawing primitive output path must reference a regular file");
      }
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
    renameSync(temporaryPath, absolutePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export function writeDrawingPrimitives(
  projectRoot: string,
  document: DrawingPrimitiveDocument,
  outputName: string,
): string {
  const root = realpathSync(projectRoot);
  const target = targetPath(root, document, outputName);
  const stored: DrawingPrimitiveDocument = {
    schemaVersion: document.schemaVersion,
    source: document.source,
    sourceSha256: document.sourceSha256,
    page: document.page,
    pageCount: document.pageCount,
    pageWidth: document.pageWidth,
    pageHeight: document.pageHeight,
    rotation: document.rotation,
    cropBox: document.cropBox,
    coordinateSystem: document.coordinateSystem,
    primitiveCount: document.primitiveCount,
    primitives: document.primitives,
    warnings: document.warnings,
  };
  writeAtomically(target.absolutePath, `${JSON.stringify(stored)}\n`);
  return target.relativePath;
}

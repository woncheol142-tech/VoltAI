import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, posix } from "node:path";

import { isWithinProjectRoot } from "../projectPath.js";
import { serializeElectricalDocument } from "./serializeElectricalObjects.js";

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function ensureSecureDirectory(projectRoot: string): string {
  let currentPath = projectRoot;
  for (const part of [".volt-ai", "electrical-objects"]) {
    currentPath = join(currentPath, part);
    try {
      const stats = lstatSync(currentPath);
      if (stats.isSymbolicLink()) {
        throw new Error("Electrical object output path cannot include symbolic links");
      }
      if (!stats.isDirectory()) {
        throw new Error("Electrical object output path must contain directories only");
      }
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      mkdirSync(currentPath);
    }
    if (!isWithinProjectRoot(projectRoot, realpathSync(currentPath))) {
      throw new Error("Electrical object output path cannot include symbolic links");
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
    throw new Error(
      "outputName must be a non-hidden logical name without path separators",
    );
  }
  const sanitized = normalized
    .replace(/\s+/gu, "_")
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  if (sanitized.length === 0 || sanitized.startsWith(".")) {
    throw new Error("outputName must contain a safe file name");
  }
  return sanitized;
}

function createTarget(
  projectRoot: string,
  source: string,
  page: number,
  outputName: string,
): { absolutePath: string; relativePath: string } {
  const directory = ensureSecureDirectory(projectRoot);
  const sourceHash = createHash("sha256")
    .update(source.replace(/[\\/]+/gu, "/"), "utf8")
    .digest("hex")
    .slice(0, 12);
  const fileName = `${sanitizeOutputName(outputName)}-${sourceHash}-page-${String(page).padStart(3, "0")}.json`;
  return {
    absolutePath: join(directory, fileName),
    relativePath: posix.join(".volt-ai", "electrical-objects", fileName),
  };
}

function assertSafeTarget(absolutePath: string): void {
  try {
    const existing = lstatSync(absolutePath);
    if (existing.isSymbolicLink()) {
      throw new Error("Electrical object output path cannot include symbolic links");
    }
    if (!existing.isFile()) {
      throw new Error("Electrical object output path must reference a regular file");
    }
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
}

function writeAtomically(absolutePath: string, content: string): void {
  const temporaryPath = join(
    dirname(absolutePath),
    `.${basename(absolutePath)}.${randomUUID()}.tmp`,
  );
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    try {
      writeFileSync(descriptor, content, { encoding: "utf8" });
      fsyncSync(descriptor);
    } finally {
      const openDescriptor = descriptor;
      descriptor = undefined;
      closeSync(openDescriptor);
    }
    assertSafeTarget(absolutePath);
    renameSync(temporaryPath, absolutePath);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
  }
}

export function writeElectricalDocument(
  projectRoot: string,
  document: unknown,
  outputName: string,
): string {
  const serialized = serializeElectricalDocument(document);
  const identity = JSON.parse(serialized) as { source: string; page: number };
  const root = realpathSync(projectRoot);
  const target = createTarget(root, identity.source, identity.page, outputName);
  writeAtomically(target.absolutePath, serialized);
  return target.relativePath;
}

export const writeElectricalObjects = writeElectricalDocument;

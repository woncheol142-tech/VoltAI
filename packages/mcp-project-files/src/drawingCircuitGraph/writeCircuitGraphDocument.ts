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
import { serializeCircuitGraphDocument } from "./serializeCircuitGraphDocument.js";
import type { CircuitGraphDocument } from "./types.js";

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
  for (const part of [".volt-ai", "circuit-graphs"]) {
    currentPath = join(currentPath, part);
    try {
      const stats = lstatSync(currentPath);
      if (stats.isSymbolicLink()) {
        throw new Error(
          "Circuit graph output path cannot include symbolic links",
        );
      }
      if (!stats.isDirectory()) {
        throw new Error(
          "Circuit graph output path must contain directories only",
        );
      }
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      mkdirSync(currentPath);
    }
    if (!isWithinProjectRoot(projectRoot, realpathSync(currentPath))) {
      throw new Error(
        "Circuit graph output path cannot include symbolic links",
      );
    }
  }
  return currentPath;
}

function sanitizeOutputName(outputName: string): {
  safeName: string;
  nameHash: string;
} {
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
  const safeName = normalized
    .replace(/\s+/gu, "_")
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  if (safeName.length === 0 || safeName.startsWith(".")) {
    throw new Error("outputName must contain a safe file name");
  }
  return {
    safeName,
    nameHash: createHash("sha256")
      .update(normalized, "utf8")
      .digest("hex")
      .slice(0, 8),
  };
}

function createTarget(
  projectRoot: string,
  document: CircuitGraphDocument,
  outputName: string,
): { absolutePath: string; relativePath: string } {
  const { safeName, nameHash } = sanitizeOutputName(outputName);
  const directory = ensureSecureDirectory(projectRoot);
  const fileName =
    `${safeName}-${nameHash}-${document.sourceSha256.slice(0, 12)}` +
    `-page-${String(document.page).padStart(3, "0")}-${document.graphId.slice(4, 16)}.json`;
  return {
    absolutePath: join(directory, fileName),
    relativePath: posix.join(".volt-ai", "circuit-graphs", fileName),
  };
}

function assertSafeTarget(absolutePath: string): void {
  try {
    const stats = lstatSync(absolutePath);
    if (stats.isSymbolicLink()) {
      throw new Error(
        "Circuit graph output path cannot include symbolic links",
      );
    }
    if (!stats.isFile()) {
      throw new Error(
        "Circuit graph output path must reference a regular file",
      );
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

export function writeCircuitGraphDocument(
  projectRoot: string,
  documentValue: unknown,
  outputName: string,
): string {
  const serialized = serializeCircuitGraphDocument(documentValue);
  const document = documentValue as CircuitGraphDocument;
  const root = realpathSync(projectRoot);
  const target = createTarget(root, document, outputName);
  writeAtomically(target.absolutePath, serialized);
  return target.relativePath;
}

import { realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, resolve, sep } from "node:path";

export function assertProjectRoot(projectRoot: string | undefined): string {
  if (!projectRoot) {
    throw new Error("PROJECT_ROOT is required");
  }

  let stats;

  try {
    stats = statSync(projectRoot);
  } catch {
    throw new Error("PROJECT_ROOT must be an existing directory");
  }

  if (!stats.isDirectory()) {
    throw new Error("PROJECT_ROOT must be an existing directory");
  }

  return realpathSync(projectRoot);
}

function isWithinProjectRoot(projectRoot: string, absolutePath: string): boolean {
  const rootPrefix = projectRoot.endsWith(sep) ? projectRoot : `${projectRoot}${sep}`;

  return absolutePath === projectRoot || absolutePath.startsWith(rootPrefix);
}

export function resolveKecPdfPath(projectRoot: string, relativePath: string): string {
  if (isAbsolute(relativePath)) {
    throw new Error("relativePath must be relative");
  }

  const pathParts = relativePath.split(/[\\/]+/);

  if (pathParts.includes("..")) {
    throw new Error("relativePath must stay within PROJECT_ROOT");
  }

  if (extname(relativePath).toLowerCase() !== ".pdf") {
    throw new Error("Only .pdf files are supported");
  }

  const absolutePath = resolve(projectRoot, relativePath);

  if (!isWithinProjectRoot(projectRoot, absolutePath)) {
    throw new Error("relativePath must stay within PROJECT_ROOT");
  }

  try {
    const stats = statSync(absolutePath);

    if (!stats.isFile()) {
      throw new Error("PDF file does not exist");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "PDF file does not exist") {
      throw error;
    }

    throw new Error("PDF file does not exist");
  }

  const realPath = realpathSync(absolutePath);

  if (!isWithinProjectRoot(projectRoot, realPath)) {
    throw new Error("relativePath must stay within PROJECT_ROOT");
  }

  return realPath;
}

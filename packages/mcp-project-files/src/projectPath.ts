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

export function assertAllowedRelativePath(
  relativePath: string,
  allowedExtensions?: Set<string>,
): void {
  if (isAbsolute(relativePath)) {
    throw new Error("relativePath must be relative");
  }

  const pathParts = relativePath.split(/[\\/]+/);

  if (pathParts.includes("..")) {
    throw new Error("relativePath must stay within PROJECT_ROOT");
  }

  if (pathParts.some((part) => part.startsWith(".") || part === "node_modules")) {
    throw new Error("relativePath cannot include hidden folders or node_modules");
  }

  if (allowedExtensions) {
    const extension = extname(relativePath).toLowerCase();

    if (!allowedExtensions.has(extension)) {
      throw new Error(`Only ${Array.from(allowedExtensions).join(" and ")} files are supported`);
    }
  }
}

export function isWithinProjectRoot(projectRoot: string, absolutePath: string): boolean {
  const rootPrefix = projectRoot.endsWith(sep) ? projectRoot : `${projectRoot}${sep}`;

  return absolutePath === projectRoot || absolutePath.startsWith(rootPrefix);
}

export function resolveProjectFile(
  projectRoot: string,
  relativePath: string,
  missingMessage: string,
): string {
  const candidatePath = resolve(projectRoot, relativePath);

  if (!isWithinProjectRoot(projectRoot, candidatePath)) {
    throw new Error("relativePath must stay within PROJECT_ROOT");
  }

  let stats;

  try {
    stats = statSync(candidatePath);
  } catch {
    throw new Error(missingMessage);
  }

  if (!stats.isFile()) {
    throw new Error(missingMessage);
  }

  const realPath = realpathSync(candidatePath);

  if (!isWithinProjectRoot(projectRoot, realPath)) {
    throw new Error("relativePath must stay within PROJECT_ROOT");
  }

  return realPath;
}

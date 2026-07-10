import { readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";

import type { VoltAiTool } from "@voltai/mcp-core";

import { assertProjectRoot } from "../projectPath.js";

const allowedExtensions = new Set([".pdf", ".xlsx", ".xls", ".dwg", ".dxf"]);
const excludedDirectoryNames = new Set(["node_modules"]);

export type ProjectFile = {
  name: string;
  relativePath: string;
  extension: string;
  size: number;
  modifiedAt: string;
};

function shouldSkipDirectory(name: string): boolean {
  return name.startsWith(".") || excludedDirectoryNames.has(name);
}

function normalizeRelativePath(path: string): string {
  return path.split(sep).join("/");
}

export function listProjectFiles(projectRoot: string | undefined): ProjectFile[] {
  const root = assertProjectRoot(projectRoot);
  const results: ProjectFile[] = [];

  function visitDirectory(directory: string): void {
    const entries = readdirSync(directory, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!shouldSkipDirectory(entry.name)) {
          visitDirectory(absolutePath);
        }

        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = extname(entry.name).toLowerCase();

      if (!allowedExtensions.has(extension)) {
        continue;
      }

      const stats = statSync(absolutePath);

      results.push({
        name: basename(entry.name),
        relativePath: normalizeRelativePath(relative(root, absolutePath)),
        extension,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      });
    }
  }

  visitDirectory(root);

  return results.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function createListProjectFilesTool(): VoltAiTool<ProjectFile[]> {
  return {
    name: "list_project_files",
    description: "List PDF, Excel, DWG, and DXF files under PROJECT_ROOT.",
    inputSchema: {},
    handler: async () => listProjectFiles(process.env.PROJECT_ROOT),
  };
}

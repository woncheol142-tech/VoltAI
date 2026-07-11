import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const packagesRoot = join(root, "packages");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (entry === "dist" || entry === "node_modules") {
      return [];
    }

    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });
}

function workspacePackages(): Map<string, string> {
  return new Map(
    readdirSync(packagesRoot).flatMap((directory) => {
      const packageJsonPath = join(packagesRoot, directory, "package.json");

      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
          name?: unknown;
        };

        return typeof packageJson.name === "string"
          ? [[packageJson.name, `./packages/${directory}/src/index.ts`] as const]
          : [];
      } catch {
        return [];
      }
    }),
  );
}

function importedWorkspacePackages(packageNames: Set<string>): Map<string, string[]> {
  const imports = new Map<string, string[]>();
  const importPattern = /(?:from\s+|import\s*\()?["'](@voltai\/[^"']+)["']/g;

  for (const file of [...sourceFiles(packagesRoot), ...sourceFiles(join(root, "tests"))]) {
    const source = readFileSync(file, "utf8");

    for (const match of source.matchAll(importPattern)) {
      const packageName = match[1];

      if (!packageName || !packageNames.has(packageName)) {
        continue;
      }

      imports.set(packageName, [...(imports.get(packageName) ?? []), relative(root, file)]);
    }
  }

  return imports;
}

describe("workspace source resolution", () => {
  it("aliases every imported workspace package directly to src/index.ts", () => {
    const packages = workspacePackages();
    const imports = importedWorkspacePackages(new Set(packages.keys()));
    const vitestConfig = readFileSync(join(root, "vitest.config.ts"), "utf8");
    const missing = Array.from(imports.keys()).filter((packageName) => {
      const sourceEntry = packages.get(packageName);

      return !vitestConfig.includes(`"${packageName}"`) || !vitestConfig.includes(sourceEntry ?? "");
    });

    expect(missing, `Missing source aliases for: ${missing.join(", ")}`).toEqual([]);
  });

  it("keeps CI test before build and explicitly removes stale package dist output", () => {
    const workflow = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
    const testIndex = workflow.indexOf("pnpm test");
    const buildIndex = workflow.indexOf("pnpm build");

    expect(testIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeGreaterThan(testIndex);
    expect(workflow).toMatch(/(?:rm -rf|find).*packages.*dist/);
  });
});

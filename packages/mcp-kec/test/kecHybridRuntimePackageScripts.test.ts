import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDirectory, "..");
const workspaceRoot = join(packageRoot, "..", "..");

type PackageJson = Readonly<{
  scripts?: Readonly<Record<string, string>>;
  dependencies?: Readonly<Record<string, string>>;
  devDependencies?: Readonly<Record<string, string>>;
}>;

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function readPackageJson(): PackageJson {
  return JSON.parse(readText(join(packageRoot, "package.json"))) as PackageJson;
}

describe("explicit KEC hybrid runtime package scripts", () => {
  it("exposes the deterministic source hybrid command", () => {
    const scripts = readPackageJson().scripts;

    expect(scripts?.["dev:hybrid"]).toBe("tsx src/hybrid.ts");
  });

  it("exposes the deterministic built hybrid command", () => {
    const scripts = readPackageJson().scripts;

    expect(scripts?.["start:hybrid"]).toBe("node dist/hybrid.js");
  });

  it("preserves every existing default package command", () => {
    const scripts = readPackageJson().scripts;

    expect(scripts?.dev).toBe("tsx src/index.ts");
    expect(scripts?.start).toBe("node dist/index.js");
    expect(scripts?.build).toBe("tsc -p tsconfig.json");
    expect(scripts?.test).toBe("vitest run --root ../.. packages/mcp-kec/test");
    expect(scripts?.dev).not.toContain("hybrid");
    expect(scripts?.start).not.toContain("hybrid");
    expect(scripts?.build).not.toContain("hybrid");
    expect(scripts?.test).not.toContain("hybrid");
  });

  it("adds no enable flag or package lifecycle hook", () => {
    const packageJson = readPackageJson();
    const scripts = packageJson.scripts ?? {};

    expect(JSON.stringify(packageJson)).not.toContain("KEC_HYBRID_ENABLED");
    for (const lifecycle of [
      "preinstall",
      "postinstall",
      "prepare",
      "prestart",
      "poststart",
    ]) {
      expect(scripts).not.toHaveProperty(lifecycle);
    }
  });

  it("uses the existing tsx tool without unapproved dependency drift", () => {
    const packageJson = readPackageJson();

    expect(Object.keys(packageJson.dependencies ?? {}).sort()).toEqual([
      "@modelcontextprotocol/sdk",
      "@voltai/extraction-core",
      "@voltai/knowledge-core",
      "@voltai/knowledge-sqlite",
      "@voltai/mcp-core",
      "@voltai/source-core",
      "pdfjs-dist",
      "zod",
    ]);
    expect(Object.keys(packageJson.devDependencies ?? {}).sort()).toEqual([
      "tsx",
    ]);
    expect(packageJson.devDependencies?.tsx).toBe("^4.19.2");
  });

  it("keeps Docker defaults on the legacy runtime", () => {
    const dockerfile = readText(join(workspaceRoot, "Dockerfile"));
    const compose = readText(join(workspaceRoot, "docker-compose.yml"));

    for (const source of [dockerfile, compose]) {
      expect(source).not.toContain("dev:hybrid");
      expect(source).not.toContain("start:hybrid");
      expect(source).not.toContain("src/hybrid.ts");
      expect(source).not.toContain("dist/hybrid.js");
      expect(source).not.toContain("KEC_HYBRID_ENABLED");
    }

    expect(dockerfile).toContain(
      'CMD ["pnpm", "--filter", "@voltai/mcp-kec", "start"]',
    );
    expect(compose).toContain("command: pnpm --filter @voltai/mcp-kec start");
  });
});

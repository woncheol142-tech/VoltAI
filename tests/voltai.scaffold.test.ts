import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const expectedPackages = [
  "mcp-kec",
  "mcp-cad",
  "mcp-material",
  "mcp-estimate",
] as const;

const expectedRootFiles = [
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "eslint.config.js",
  "prettier.config.js",
  "vitest.config.ts",
  "Dockerfile",
  "docker-compose.yml",
  ".env.example",
  "README.md",
  ".github/workflows/ci.yml",
] as const;

describe("VoltAI monorepo scaffold", () => {
  it("contains the required root configuration files", () => {
    for (const file of expectedRootFiles) {
      expect(existsSync(join(root, file)), `${file} should exist`).toBe(true);
    }
  });

  it("uses pnpm workspaces for packages/*", () => {
    const workspacePath = join(root, "pnpm-workspace.yaml");
    expect(existsSync(workspacePath)).toBe(true);

    const workspace = readFileSync(workspacePath, "utf8");
    expect(workspace).toContain("packages:");
    expect(workspace).toContain("packages/*");
  });

  it("defines shared scripts for lint, test, and build", () => {
    const packagePath = join(root, "package.json");
    expect(existsSync(packagePath)).toBe(true);

    const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
    expect(pkg.packageManager).toMatch(/^pnpm@/);
    expect(pkg.scripts).toMatchObject({
      lint: expect.any(String),
      test: expect.any(String),
      build: expect.any(String),
    });
  });

  it("creates every MCP server package as an independently runnable package", () => {
    for (const name of expectedPackages) {
      const packagePath = join(root, "packages", name, "package.json");
      expect(existsSync(packagePath), `${name}/package.json should exist`).toBe(true);

      const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
      expect(pkg.name).toBe(`@voltai/${name}`);
      expect(pkg.scripts).toMatchObject({
        dev: expect.any(String),
        build: expect.any(String),
        start: expect.any(String),
        test: expect.any(String),
      });
      expect(pkg.dependencies).toHaveProperty("@modelcontextprotocol/sdk");
    }
  });

  it("gives every MCP server a placeholder tool entrypoint and tests", () => {
    for (const name of expectedPackages) {
      expect(existsSync(join(root, "packages", name, "src", "index.ts"))).toBe(true);
      expect(existsSync(join(root, "packages", name, "src", "tools", "placeholder.ts"))).toBe(true);
      expect(existsSync(join(root, "packages", name, "test", "placeholder.test.ts"))).toBe(true);
    }
  });

  it("documents install, run, test, build, and Docker workflows", () => {
    const readmePath = join(root, "README.md");
    expect(existsSync(readmePath)).toBe(true);

    const readme = readFileSync(readmePath, "utf8");
    for (const phrase of [
      "pnpm install",
      "pnpm lint",
      "pnpm test",
      "pnpm build",
      "docker compose up",
      "mcp-kec",
      "mcp-cad",
      "mcp-material",
      "mcp-estimate",
    ]) {
      expect(readme).toContain(phrase);
    }
  });

  it("runs CI through install, lint, test, and build", () => {
    const ciPath = join(root, ".github", "workflows", "ci.yml");
    expect(existsSync(ciPath)).toBe(true);

    const ci = readFileSync(ciPath, "utf8");
    expect(ci).toContain("pnpm install");
    expect(ci).toContain("pnpm lint");
    expect(ci).toContain("pnpm test");
    expect(ci).toContain("pnpm build");
  });
});

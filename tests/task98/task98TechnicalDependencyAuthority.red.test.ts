import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  TASK98_R0_CONTRACTS,
  task98Paths,
} from "./fixtures/task98R0ArchitectureContract.js";
import {
  assertTechnicalDependencyAuthority,
  Task98TechnicalDependencyError,
} from "./helpers/task98TechnicalDependencyAuthority.js";

const temporaryRoots: string[] = [];

function sourceFixture(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "task98-r0-dependency-lint-"));
  temporaryRoots.push(root);
  for (const [relativePath, source] of Object.entries(files)) {
    const path = join(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source, "utf8");
  }
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Task98 R0 BG-2 dependency authority", () => {
  it(`[BG-2] ${TASK98_R0_CONTRACTS["BG-2"].testName}`, () => {
    expect(() =>
      assertTechnicalDependencyAuthority(task98Paths.mcpKecSource),
    ).not.toThrow();
  });

  it("rejects a direct authority import", () => {
    const root = sourceFixture({
      "technical.ts":
        'import "@voltai/source-admission";\nexport function extractKecV2Technical() {}\n',
    });
    expect(() =>
      assertTechnicalDependencyAuthority(root, join(root, "technical.ts")),
    ).toThrowError(
      expect.objectContaining({
        code: "FORBIDDEN_TECHNICAL_DEPENDENCY",
      }) as Task98TechnicalDependencyError,
    );
  });

  it("rejects a transitive authority import", () => {
    const root = sourceFixture({
      "technical.ts":
        'import { parse } from "./parser.js";\nexport function extractKecV2Technical() { return parse(); }\n',
      "parser.ts":
        'import "@voltai/kec-source-runtime";\nexport function parse() {}\n',
    });
    expect(() =>
      assertTechnicalDependencyAuthority(root, join(root, "technical.ts")),
    ).toThrowError(
      expect.objectContaining({
        code: "FORBIDDEN_TECHNICAL_DEPENDENCY",
      }) as Task98TechnicalDependencyError,
    );
  });

  it("rejects an authority import behind a workspace package boundary", () => {
    const root = sourceFixture({
      "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
      "packages/mcp-kec/package.json":
        '{"name":"@voltai/mcp-kec","private":true}\n',
      "packages/mcp-kec/src/technical.ts":
        'import { core } from "@voltai/extraction-core";\nexport function extractKecV2Technical() { return core(); }\n',
      "packages/extraction-core/package.json":
        '{"name":"@voltai/extraction-core","private":true}\n',
      "packages/extraction-core/src/index.ts":
        'import "@voltai/source-admission";\nexport function core() {}\n',
    });
    const sourceRoot = join(root, "packages/mcp-kec/src");
    expect(() =>
      assertTechnicalDependencyAuthority(
        sourceRoot,
        join(sourceRoot, "technical.ts"),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "FORBIDDEN_TECHNICAL_DEPENDENCY",
      }) as Task98TechnicalDependencyError,
    );
  });

  it("rejects an injected binding-verifier capability", () => {
    const root = sourceFixture({
      "technical.ts":
        "export function extractKecV2Technical(verifyObservedBinding: unknown) { return verifyObservedBinding; }\n",
    });
    expect(() =>
      assertTechnicalDependencyAuthority(root, join(root, "technical.ts")),
    ).toThrowError(
      expect.objectContaining({
        code: "FORBIDDEN_AUTHORITY_CAPABILITY",
      }) as Task98TechnicalDependencyError,
    );
  });

  it("accepts a clean generic parser chain ending in pdfjs", () => {
    const root = sourceFixture({
      "technical.ts":
        'import { parse } from "./parser.js";\nexport function extractKecV2Technical() { return parse(); }\n',
      "parser.ts":
        'import "pdfjs-dist/legacy/build/pdf.mjs";\nexport function parse() { return "technical"; }\n',
    });
    expect(
      assertTechnicalDependencyAuthority(root, join(root, "technical.ts"))
        .visitedFiles,
    ).toHaveLength(2);
  });
});

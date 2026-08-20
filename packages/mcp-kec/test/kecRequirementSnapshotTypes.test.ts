import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDirectory, "..");
const workspaceRoot = join(packageRoot, "..", "..");
const fixturePath = join(
  testDirectory,
  "fixtures",
  "requirementSnapshotContracts.ts",
);
const producerPath = join(
  packageRoot,
  "src",
  "knowledge",
  "requirementExtraction.ts",
);
const storePath = join(packageRoot, "src", "requirementSnapshot", "index.ts");
const producerSource = readFileSync(producerPath, "utf8");
const productionTypeSurfaceExists =
  existsSync(storePath) &&
  /export\s+type\s+KecRequirementExtractionBinding\b/u.test(producerSource) &&
  /export\s+type\s+KecRequirementExtractionSnapshot\b/u.test(producerSource);

function diagnosticsText(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics
    .map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n",
      );
      if (!diagnostic.file || diagnostic.start === undefined) return message;
      const position = diagnostic.file.getLineAndCharacterOfPosition(
        diagnostic.start,
      );
      return `${relative(workspaceRoot, diagnostic.file.fileName)}:${position.line + 1}:${position.character + 1} ${message}`;
    })
    .join("\n");
}

describe("Task91 source type-contract fixture", () => {
  it("exists and imports the production contracts instead of redeclaring them", () => {
    const fixture = readFileSync(fixturePath, "utf8");
    expect(existsSync(fixturePath)).toBe(true);
    expect(fixture).toContain(
      'from "../../src/knowledge/requirementExtraction.js"',
    );
    expect(fixture).toContain('from "../../src/requirementSnapshot/index.js"');
    expect(fixture).not.toMatch(
      /(?:interface|type)\s+(?:StoredRequirementEntry|RequirementKeyCodec|RequirementLocatorCodec|RequirementPopulationId|RequirementSetId|ExtractionRunId|RequirementProvenance)\b/u,
    );
  });
});

describe.runIf(productionTypeSurfaceExists)(
  "Task91 exact source-first type surface",
  () => {
    it("type-checks exact readonly envelope and store signatures", () => {
      const program = ts.createProgram({
        rootNames: [fixturePath],
        options: {
          module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
          target: ts.ScriptTarget.ES2022,
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          customConditions: ["voltai-source"],
        },
      });
      const diagnostics = ts.getPreEmitDiagnostics(program);
      expect(diagnostics, diagnosticsText(diagnostics)).toEqual([]);
    });
  },
);

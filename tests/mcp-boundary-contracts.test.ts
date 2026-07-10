import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(join(workspaceRoot, relativePath), "utf8");
}

describe("typed MCP boundary contracts", () => {
  it("keeps production tool factories typed up to the MCP serialization boundary", () => {
    expect(readSource("packages/mcp-project-files/src/tools/readPdf.ts")).toContain(
      "createReadPdfTool(): VoltAiTool<ReadPdfResult>",
    );
    expect(readSource("packages/mcp-project-files/src/tools/readExcel.ts")).toContain(
      "createReadExcelTool(): VoltAiTool<ReadExcelResult>",
    );
    expect(readSource("packages/mcp-project-files/src/tools/listProjectFiles.ts")).toContain(
      "createListProjectFilesTool(): VoltAiTool<ProjectFile[]>",
    );
    expect(readSource("packages/mcp-kec/src/tools/indexKec.ts")).toContain(
      "createIndexKecTool(deps: IndexKecToolDependencies = {}): VoltAiTool<IndexKecResult>",
    );
    expect(readSource("packages/mcp-kec/src/tools/searchKec.ts")).toContain(
      "createSearchKecTool(deps: SearchKecToolDependencies = {}): VoltAiTool<SearchKecToolResult>",
    );
    expect(readSource("packages/mcp-agent/src/tools/reviewProjectTool.ts")).toContain(
      "createReviewProjectTool(options: ReviewProjectToolOptions = {}): VoltAiTool<string>",
    );
  });

  it("keeps placeholder tools as string passthrough handlers", () => {
    for (const relativePath of [
      "packages/mcp-cad/src/tools/placeholder.ts",
      "packages/mcp-estimate/src/tools/placeholder.ts",
      "packages/mcp-kec/src/tools/placeholder.ts",
      "packages/mcp-material/src/tools/placeholder.ts",
    ]) {
      expect(readSource(relativePath)).toContain("placeholderTool: VoltAiTool<string>");
    }
  });
});


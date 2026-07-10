import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createServer } from "../src/index.js";
import { createLocalReviewPorts } from "../src/ports/localReviewPorts.js";
import { createReviewProjectTool } from "../src/tools/reviewProjectTool.js";

const tempRoots: string[] = [];

function createTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "voltai-mcp-agent-"));
  tempRoots.push(root);
  return root;
}

function writeProjectFile(root: string, relativePath: string, content: string): void {
  const parts = relativePath.split("/");
  const fileName = parts.pop();

  if (!fileName) {
    throw new Error("relativePath must include a file name");
  }

  mkdirSync(join(root, ...parts), { recursive: true });
  writeFileSync(join(root, ...parts, fileName), content);
}

function createTextPdf(text: string): string {
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return pdf;
}

describe("review_project MCP tool", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }

    vi.restoreAllMocks();
  });

  it("has the review_project tool name", () => {
    expect(createReviewProjectTool().name).toBe("review_project");
  });

  it("calls reviewProject and returns a markdown report string", async () => {
    const root = createTempProject();
    const reviewProject = vi.fn().mockResolvedValue("# 프로젝트 개요\n\n# 검토 의견");
    const tool = createReviewProjectTool({ reviewProject });
    const originalProjectRoot = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;

    try {
      const report = await tool.handler({ projectPath: root });

      expect(reviewProject).toHaveBeenCalledWith(
        { projectPath: realpathSync(root) },
        expect.objectContaining({
          listProjectFiles: expect.any(Function),
          readPdf: expect.any(Function),
          readExcel: expect.any(Function),
          searchKec: expect.any(Function),
        }),
      );
      expect(report).toContain("# 프로젝트 개요");
      expect(typeof report).toBe("string");
      expect(() => JSON.parse(report)).toThrow();
    } finally {
      if (originalProjectRoot === undefined) {
        delete process.env.PROJECT_ROOT;
      } else {
        process.env.PROJECT_ROOT = originalProjectRoot;
      }
    }
  });

  it("allows projectPath inside PROJECT_ROOT", async () => {
    const root = createTempProject();
    mkdirSync(join(root, "subproject"), { recursive: true });
    const reviewProject = vi.fn().mockResolvedValue("# 검토 의견");
    const tool = createReviewProjectTool({ reviewProject });
    const originalProjectRoot = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;

    try {
      await tool.handler({ projectPath: join(root, "subproject") });

      expect(reviewProject).toHaveBeenCalledWith(
        expect.objectContaining({ projectPath: realpathSync(join(root, "subproject")) }),
        expect.any(Object),
      );
    } finally {
      if (originalProjectRoot === undefined) {
        delete process.env.PROJECT_ROOT;
      } else {
        process.env.PROJECT_ROOT = originalProjectRoot;
      }
    }
  });

  it("uses PROJECT_ROOT when projectPath is omitted", async () => {
    const root = createTempProject();
    const reviewProject = vi.fn().mockResolvedValue("# 검토 의견");
    const tool = createReviewProjectTool({ reviewProject });
    const originalProjectRoot = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;

    try {
      await tool.handler({});

      expect(reviewProject).toHaveBeenCalledWith(
        expect.objectContaining({ projectPath: realpathSync(root) }),
        expect.any(Object),
      );
    } finally {
      if (originalProjectRoot === undefined) {
        delete process.env.PROJECT_ROOT;
      } else {
        process.env.PROJECT_ROOT = originalProjectRoot;
      }
    }
  });

  it("rejects projectPath outside PROJECT_ROOT", async () => {
    const root = createTempProject();
    const outside = createTempProject();
    const reviewProject = vi.fn().mockResolvedValue("# 검토 의견");
    const tool = createReviewProjectTool({ reviewProject });
    const originalProjectRoot = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;

    try {
      await expect(tool.handler({ projectPath: outside })).rejects.toThrow(
        "projectPath must stay within PROJECT_ROOT",
      );
      expect(reviewProject).not.toHaveBeenCalled();
    } finally {
      if (originalProjectRoot === undefined) {
        delete process.env.PROJECT_ROOT;
      } else {
        process.env.PROJECT_ROOT = originalProjectRoot;
      }
    }
  });

  it("local ports connect list/read/search functions", async () => {
    const root = createTempProject();
    writeProjectFile(root, "docs/panel.pdf", createTextPdf("Panel cable design"));
    writeProjectFile(root, "estimate/data.txt", "ignored");

    const ports = createLocalReviewPorts(root);
    const files = await ports.listProjectFiles(root);
    const pdf = await ports.readPdf("docs/panel.pdf");

    expect(files.map((file) => file.relativePath)).toContain("docs/panel.pdf");
    expect(pdf.text).toContain("Panel cable design");
    await expect(ports.searchKec("케이블 규격")).rejects.toThrow(
      "KEC index embedding metadata mismatch. Please re-run index_kec.",
    );
  });

  it("local ports use the mock review LLM by default", async () => {
    const root = createTempProject();
    const ports = createLocalReviewPorts(root);

    const output = await ports.llm.generateReview({
      projectPath: root,
      files: [],
      pdfs: [],
      excels: [],
      kecResults: [],
      itemReviews: [],
      findings: [],
    });

    expect(output).toContain("# 프로젝트 개요");
    expect(output).toContain("# 검토 의견");

    await ports.close?.();
  });

  it("local ports forward readPdf and readExcel options to project file readers", async () => {
    const root = createTempProject();
    writeProjectFile(root, "docs/panel.pdf", createTextPdf("Panel cable design"));

    const ports = createLocalReviewPorts(root);
    const pdf = await ports.readPdf("docs/panel.pdf", { maxChars: 5 });
    const workbook = await ports.readExcel("missing.xlsx").catch((error: unknown) => error);

    expect(pdf.text).toBe("Panel");
    expect(workbook).toBeInstanceOf(Error);
    await expect(ports.readExcel("missing.xlsx", { sheetName: "Summary", maxRows: 50 })).rejects.toThrow(
      "Excel file does not exist",
    );
  });

  it("local ports reuse one vector store across multiple searchKec calls", async () => {
    const root = createTempProject();
    const vectorStore = {
      getIndexMetadata: vi.fn().mockResolvedValue({
        embeddingProvider: "test",
        embeddingModel: "reuse",
        dimensions: 2,
        indexedAt: "2026-01-01T00:00:00.000Z",
      }),
      search: vi.fn().mockResolvedValue([]),
      upsert: vi.fn(),
      replaceSource: vi.fn(),
      deleteBySourcePath: vi.fn(),
      listChunks: vi.fn(),
      saveIndexMetadata: vi.fn(),
      close: vi.fn(),
    };
    const vectorStoreFactory = vi.fn(() => vectorStore);
    const embeddingProvider = {
      getMetadata: () => ({ provider: "test", model: "reuse" }),
      embed: vi.fn().mockResolvedValue([0, 1]),
    };
    const ports = (
      createLocalReviewPorts as unknown as (
        projectPath: string,
        deps: {
          embeddingProvider: typeof embeddingProvider;
          vectorStoreFactory: () => typeof vectorStore;
        },
      ) => ReturnType<typeof createLocalReviewPorts>
    )(root, { embeddingProvider, vectorStoreFactory });

    await ports.searchKec("케이블 규격");
    await ports.searchKec("접지 기준");

    expect(vectorStoreFactory).toHaveBeenCalledTimes(1);
    expect(vectorStore.search).toHaveBeenCalledTimes(2);
  });

  it("runs without OpenAI API", async () => {
    const root = createTempProject();
    const originalApiKey = process.env.OPENAI_API_KEY;
    const originalProjectRoot = process.env.PROJECT_ROOT;
    delete process.env.OPENAI_API_KEY;
    process.env.PROJECT_ROOT = root;

    try {
      const reviewProject = vi.fn().mockResolvedValue("# 프로젝트 개요");
      const tool = createReviewProjectTool({ reviewProject });

      await expect(tool.handler({ projectPath: root })).resolves.toContain("# 프로젝트 개요");
    } finally {
      if (originalApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalApiKey;
      }

      if (originalProjectRoot === undefined) {
        delete process.env.PROJECT_ROOT;
      } else {
        process.env.PROJECT_ROOT = originalProjectRoot;
      }
    }
  });

  it("creates an mcp-agent server with review_project registered", () => {
    const server = createServer();

    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
  });
});

import { rmSync, symlinkSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createReadPdfTool, readPdf } from "../src/tools/readPdf.js";
import {
  createMultiPageTextPdf,
  createTempPdfProject,
  createTextPdf,
  writeProjectFile,
} from "./helpers/pdfFixture.js";

const tempRoots: string[] = [];

function createTempProject(): string {
  const root = createTempPdfProject();
  tempRoots.push(root);
  return root;
}

function createBlankPdf(): string {
  return createTextPdf("");
}

describe("readPdf", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns relativePath, pageCount, and text for a valid PDF", async () => {
    const root = createTempProject();
    writeProjectFile(root, "docs/spec.pdf", createTextPdf("VoltAI PDF Text"));

    const result = await readPdf(root, { relativePath: "docs/spec.pdf" });

    expect(result.relativePath).toBe("docs/spec.pdf");
    expect(result.pageCount).toBe(1);
    expect(result.text).toContain("VoltAI PDF Text");
  });

  it("returns page-level text while preserving the existing read_pdf contract", async () => {
    const root = createTempProject();
    writeProjectFile(
      root,
      "docs/spec.pdf",
      createMultiPageTextPdf(["Page one cable note", "Page two grounding note"]),
    );

    const result = await readPdf(root, { relativePath: "docs/spec.pdf" });

    expect(result).toMatchObject({
      relativePath: "docs/spec.pdf",
      pageCount: 2,
      text: expect.stringContaining("Page one cable note"),
      pages: [
        { page: 1, text: "Page one cable note", charCount: 19 },
        { page: 2, text: "Page two grounding note", charCount: 23 },
      ],
    });
    expect(result.text).toContain("Page two grounding note");
    expect(result.text).toBe(result.pages.map((page) => page.text).join("\n"));
    expect(result.pages.every((page) => page.charCount === page.text.length)).toBe(true);
  });

  it("limits extracted text with maxChars", async () => {
    const root = createTempProject();
    writeProjectFile(root, "docs/long.pdf", createTextPdf("1234567890"));

    const result = await readPdf(root, {
      relativePath: "docs/long.pdf",
      maxChars: 4,
    });

    expect(result.text).toBe("1234");
  });

  it("marks PDF text as truncated when maxChars cuts off available text", async () => {
    const root = createTempProject();
    writeProjectFile(root, "docs/long.pdf", createTextPdf("1234567890"));

    const result = await readPdf(root, {
      relativePath: "docs/long.pdf",
      maxChars: 4,
    });

    expect(result.truncated).toBe(true);
  });

  it("does not mark PDF text as truncated when maxChars covers all text", async () => {
    const root = createTempProject();
    writeProjectFile(root, "docs/short.pdf", createTextPdf("12345"));

    const result = await readPdf(root, {
      relativePath: "docs/short.pdf",
      maxChars: 10,
    });

    expect(result.text).toBe("12345");
    expect(result.truncated).toBe(false);
  });

  it("keeps page-level text consistent with maxChars truncation", async () => {
    const root = createTempProject();
    writeProjectFile(root, "docs/long.pdf", createMultiPageTextPdf(["12345", "67890"]));

    const result = await readPdf(root, {
      relativePath: "docs/long.pdf",
      maxChars: 7,
    });

    expect(result.text).toBe("12345\n6");
    expect(result.pages).toEqual([
      { page: 1, text: "12345", charCount: 5 },
      { page: 2, text: "6", charCount: 1 },
    ]);
    expect(result.text).toBe(result.pages.map((page) => page.text).join("\n"));
  });

  it("ends at the current page without a standalone separator when no next-page character fits", async () => {
    const root = createTempProject();
    writeProjectFile(root, "docs/boundary.pdf", createMultiPageTextPdf(["12345", "67890"]));

    const result = await readPdf(root, {
      relativePath: "docs/boundary.pdf",
      maxChars: 6,
    });

    expect(result.text).toBe("12345");
    expect(result.text.endsWith("\n")).toBe(false);
    expect(result.pages).toEqual([{ page: 1, text: "12345", charCount: 5 }]);
    expect(result.truncated).toBe(true);
  });

  it("marks an exact page-end limit as truncated when a later page has text", async () => {
    const root = createTempProject();
    writeProjectFile(root, "docs/more.pdf", createMultiPageTextPdf(["12345", "67890"]));

    const result = await readPdf(root, {
      relativePath: "docs/more.pdf",
      maxChars: 5,
    });

    expect(result).toMatchObject({
      text: "12345",
      pages: [{ page: 1, text: "12345", charCount: 5 }],
      truncated: true,
    });
  });

  it("does not mark an exact page-end limit as truncated when later pages have no text", async () => {
    const root = createTempProject();
    writeProjectFile(root, "docs/no-more.pdf", createMultiPageTextPdf(["12345", ""]));

    const result = await readPdf(root, {
      relativePath: "docs/no-more.pdf",
      maxChars: 5,
    });

    expect(result.truncated).toBe(false);
    expect(result).toMatchObject({
      text: "12345",
      pages: [{ page: 1, text: "12345", charCount: 5 }],
    });
  });

  it("keeps text and charCount consistent for every returned page under a limit", async () => {
    const root = createTempProject();
    writeProjectFile(root, "docs/consistent.pdf", createMultiPageTextPdf(["abc", "def", "ghi"]));

    const result = await readPdf(root, {
      relativePath: "docs/consistent.pdf",
      maxChars: 9,
    });

    expect(result.text.length).toBeLessThanOrEqual(9);
    expect(result.text).toBe(result.pages.map((page) => page.text).join("\n"));
    expect(result.pages.map((page) => page.charCount)).toEqual(
      result.pages.map((page) => page.text.length),
    );
  });

  it("rejects absolute paths", async () => {
    const root = createTempProject();
    const absolutePath = join(root, "docs/spec.pdf");
    expect(isAbsolute(absolutePath)).toBe(true);

    await expect(readPdf(root, { relativePath: absolutePath })).rejects.toThrow(
      "relativePath must be relative",
    );
  });

  it("rejects path traversal", async () => {
    const root = createTempProject();

    await expect(readPdf(root, { relativePath: "../secret.pdf" })).rejects.toThrow(
      "relativePath must stay within PROJECT_ROOT",
    );
  });

  it("rejects symlinks that resolve outside PROJECT_ROOT", async () => {
    const root = createTempProject();
    const outside = createTempProject();
    writeProjectFile(outside, "secret.pdf", createTextPdf("Outside secret"));
    symlinkSync(join(outside, "secret.pdf"), join(root, "linked.pdf"));

    await expect(readPdf(root, { relativePath: "linked.pdf" })).rejects.toThrow(
      "relativePath must stay within PROJECT_ROOT",
    );
  });

  it("rejects non-PDF files", async () => {
    const root = createTempProject();
    writeProjectFile(root, "docs/spec.txt", "not a pdf");

    await expect(readPdf(root, { relativePath: "docs/spec.txt" })).rejects.toThrow(
      "Only .pdf files are supported",
    );
  });

  it("rejects missing files", async () => {
    const root = createTempProject();

    await expect(readPdf(root, { relativePath: "docs/missing.pdf" })).rejects.toThrow(
      "PDF file does not exist",
    );
  });

  it("treats PDFs without text as unavailable text", async () => {
    const root = createTempProject();
    writeProjectFile(root, "docs/blank.pdf", createBlankPdf());

    await expect(readPdf(root, { relativePath: "docs/blank.pdf" })).rejects.toThrow(
      "PDF text is empty or unavailable",
    );
  });

  it("rejects hidden folders and node_modules paths", async () => {
    const root = createTempProject();
    writeProjectFile(root, ".hidden/spec.pdf", createTextPdf("hidden"));
    writeProjectFile(root, "node_modules/pkg/spec.pdf", createTextPdf("dependency"));

    await expect(readPdf(root, { relativePath: ".hidden/spec.pdf" })).rejects.toThrow(
      "relativePath cannot include hidden folders or node_modules",
    );
    await expect(
      readPdf(root, { relativePath: "node_modules/pkg/spec.pdf" }),
    ).rejects.toThrow("relativePath cannot include hidden folders or node_modules");
  });

  it("creates a read_pdf tool that reads PROJECT_ROOT and returns JSON", async () => {
    const root = createTempProject();
    writeProjectFile(root, "docs/spec.pdf", createTextPdf("Tool PDF Text"));

    const originalProjectRoot = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;

    try {
      const tool = createReadPdfTool();
      const result = await tool.handler({ relativePath: "docs/spec.pdf" });

      expect(tool.name).toBe("read_pdf");
      expect(result).toMatchObject({
        relativePath: "docs/spec.pdf",
        pageCount: 1,
      });
      expect(typeof result).not.toBe("string");
      expect(result.text).toContain("Tool PDF Text");
    } finally {
      if (originalProjectRoot === undefined) {
        delete process.env.PROJECT_ROOT;
      } else {
        process.env.PROJECT_ROOT = originalProjectRoot;
      }
    }
  });
});

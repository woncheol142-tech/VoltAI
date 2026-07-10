import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createReadPdfTool, readPdf } from "../src/tools/readPdf.js";

const tempRoots: string[] = [];

function createTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "voltai-read-pdf-"));
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

function createMultiPageTextPdf(pageTexts: string[]): string {
  const pageObjects = pageTexts.map((text, index) => {
    const contentObjectNumber = 4 + pageTexts.length + index;

    return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`;
  });
  const contentObjects = pageTexts.map((text) => {
    const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;

    return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  const pageRefs = pageObjects.map((_, index) => `${4 + index} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageRefs}] /Count ${pageTexts.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...pageObjects,
    ...contentObjects,
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
        { page: 1, text: "Page one cable note" },
        { page: 2, text: "Page two grounding note" },
      ],
    });
    expect(result.text).toContain("Page two grounding note");
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
      { page: 1, text: "12345" },
      { page: 2, text: "6" },
    ]);
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

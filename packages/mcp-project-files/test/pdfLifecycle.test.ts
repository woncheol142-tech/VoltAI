import { rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTempPdfProject, writeProjectFile } from "./helpers/pdfFixture.js";

const pdfMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: pdfMocks.getDocument,
}));

import { readPdf } from "../src/tools/readPdf.js";
import { renderPdfPage } from "../src/tools/renderPdfPage.js";

const tempRoots: string[] = [];

function createProjectWithPdf(): string {
  const root = createTempPdfProject();
  tempRoots.push(root);
  writeProjectFile(root, "docs/spec.pdf", "%PDF-1.4\n%%EOF\n");
  return root;
}

describe("PDF.js lifecycle cleanup", () => {
  afterEach(() => {
    pdfMocks.getDocument.mockReset();
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("destroys the read_pdf loading task when document loading fails", async () => {
    const root = createProjectWithPdf();
    const destroy = vi.fn(async () => {});
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.reject(new Error("PDF loading failed")),
      destroy,
    });

    await expect(readPdf(root, { relativePath: "docs/spec.pdf" })).rejects.toThrow(
      "PDF loading failed",
    );
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("cleans each read_pdf page after extracting its text", async () => {
    const root = createProjectWithPdf();
    const pageCleanup = vi.fn();
    const documentCleanup = vi.fn(async () => {});
    const destroy = vi.fn(async () => {});
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn(async () => ({
          getTextContent: vi.fn(async () => ({ items: [{ str: "Lifecycle text" }] })),
          cleanup: pageCleanup,
        })),
        cleanup: documentCleanup,
      }),
      destroy,
    });

    await expect(readPdf(root, { relativePath: "docs/spec.pdf" })).resolves.toMatchObject({
      text: "Lifecycle text",
    });
    expect(pageCleanup).toHaveBeenCalledOnce();
    expect(documentCleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("cleans the render page when canvas creation fails", async () => {
    const root = createProjectWithPdf();
    const pageCleanup = vi.fn();
    const documentCleanup = vi.fn(async () => {});
    const destroy = vi.fn(async () => {});
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn(async () => ({
          getViewport: vi.fn(() => ({ width: 612, height: 792 })),
          cleanup: pageCleanup,
        })),
        canvasFactory: {
          create: vi.fn(() => {
            throw new Error("Canvas creation failed");
          }),
        },
        cleanup: documentCleanup,
      }),
      destroy,
    });

    await expect(
      renderPdfPage(root, { relativePath: "docs/spec.pdf", page: 1 }),
    ).rejects.toThrow("Canvas creation failed");
    expect(pageCleanup).toHaveBeenCalledOnce();
    expect(documentCleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("destroys the render loading task even when document cleanup fails", async () => {
    const root = createProjectWithPdf();
    const documentCleanup = vi.fn(async () => {
      throw new Error("Document cleanup failed");
    });
    const destroy = vi.fn(async () => {});
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        cleanup: documentCleanup,
      }),
      destroy,
    });

    await expect(
      renderPdfPage(root, { relativePath: "docs/spec.pdf", page: 2 }),
    ).rejects.toThrow("Document cleanup failed");
    expect(documentCleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("destroys the render loading task when document loading fails", async () => {
    const root = createProjectWithPdf();
    const destroy = vi.fn(async () => {});
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.reject(new Error("PDF loading failed")),
      destroy,
    });

    await expect(
      renderPdfPage(root, { relativePath: "docs/spec.pdf", page: 1 }),
    ).rejects.toThrow("PDF loading failed");
    expect(destroy).toHaveBeenCalledOnce();
  });
});

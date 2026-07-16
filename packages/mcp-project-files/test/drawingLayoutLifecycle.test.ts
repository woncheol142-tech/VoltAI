import { rmSync, symlinkSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTempPdfProject, writeProjectFile } from "./helpers/pdfFixture.js";

const pdfMocks = vi.hoisted(() => ({ getDocument: vi.fn() }));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: pdfMocks.getDocument,
  Util: {
    transform(left: number[], right: number[]) {
      return [
        left[0] * right[0] + left[2] * right[1],
        left[1] * right[0] + left[3] * right[1],
        left[0] * right[2] + left[2] * right[3],
        left[1] * right[2] + left[3] * right[3],
        left[0] * right[4] + left[2] * right[5] + left[4],
        left[1] * right[4] + left[3] * right[5] + left[5],
      ];
    },
  },
}));

type ExtractDrawingLayout = (
  root: string | undefined,
  input: unknown,
) => Promise<unknown>;

const modulePath = "../src/tools/extractDrawingLayout.js";
const roots: string[] = [];

async function loadExtractor(): Promise<ExtractDrawingLayout> {
  const module = (await import(modulePath)) as {
    extractDrawingLayout: ExtractDrawingLayout;
  };
  return module.extractDrawingLayout;
}

function tempRoot(): string {
  const root = createTempPdfProject();
  roots.push(root);
  writeProjectFile(root, "docs/layout.pdf", "%PDF-1.7\n%%EOF\n");
  return root;
}

function validPage(overrides: Record<string, unknown> = {}) {
  return {
    rotate: 0,
    view: [0, 0, 600, 800],
    getViewport: vi.fn(() => ({
      width: 600,
      height: 800,
      transform: [1, 0, 0, -1, 0, 800],
    })),
    getTextContent: vi.fn(async () => ({
      items: [
        {
          str: "MCCB",
          transform: [12, 0, 0, 12, 100, 700],
          width: 40,
          height: 12,
          fontName: "FixtureFont",
          dir: "ltr",
          hasEOL: false,
        },
      ],
    })),
    cleanup: vi.fn(),
    ...overrides,
  };
}

function documentMock(page = validPage()) {
  return {
    numPages: 1,
    getPage: vi.fn(async () => page),
    cleanup: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
  };
}

describe("extractDrawingLayout PDF.js lifecycle", () => {
  afterEach(() => {
    pdfMocks.getDocument.mockReset();
    vi.resetModules();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("destroys the loading task when PDF loading fails", async () => {
    const destroy = vi.fn(async () => {});
    const promise = Promise.reject(new Error("load failed"));
    void promise.catch(() => undefined);
    pdfMocks.getDocument.mockReturnValue({
      promise,
      destroy,
    });
    const extractDrawingLayout = await loadExtractor();

    await expect(
      extractDrawingLayout(tempRoot(), { relativePath: "docs/layout.pdf", page: 1 }),
    ).rejects.toThrow("load failed");
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("cleans document and loading task when page retrieval fails", async () => {
    const document = documentMock();
    document.getPage.mockRejectedValue(new Error("page failed"));
    const loadingDestroy = vi.fn(async () => {});
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(document), destroy: loadingDestroy });
    const extractDrawingLayout = await loadExtractor();

    await expect(
      extractDrawingLayout(tempRoot(), { relativePath: "docs/layout.pdf", page: 1 }),
    ).rejects.toThrow("page failed");
    expect(document.cleanup).toHaveBeenCalledOnce();
    expect(document.destroy).toHaveBeenCalledOnce();
    expect(loadingDestroy).toHaveBeenCalledOnce();
  });

  it("cleans page, document, and loading task when text extraction fails", async () => {
    const page = validPage({
      getTextContent: vi.fn(async () => {
        throw new Error("text failed");
      }),
    });
    const document = documentMock(page);
    const loadingDestroy = vi.fn(async () => {});
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(document), destroy: loadingDestroy });
    const extractDrawingLayout = await loadExtractor();

    await expect(
      extractDrawingLayout(tempRoot(), { relativePath: "docs/layout.pdf", page: 1 }),
    ).rejects.toThrow("text failed");
    expect(page.cleanup).toHaveBeenCalledOnce();
    expect(document.cleanup).toHaveBeenCalledOnce();
    expect(document.destroy).toHaveBeenCalledOnce();
    expect(loadingDestroy).toHaveBeenCalledOnce();
  });

  it("cleans every lifecycle object when normalization throws", async () => {
    const rawItem = {
      transform: [12, 0, 0, 12, 100, 700],
      width: 40,
      height: 12,
      fontName: "FixtureFont",
      dir: "ltr",
      hasEOL: false,
    };
    Object.defineProperty(rawItem, "str", {
      get() {
        throw new Error("normalization failed");
      },
    });
    const page = validPage({
      getTextContent: vi.fn(async () => ({ items: [rawItem] })),
    });
    const document = documentMock(page);
    const loadingDestroy = vi.fn(async () => {});
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(document), destroy: loadingDestroy });
    const extractDrawingLayout = await loadExtractor();

    await expect(
      extractDrawingLayout(tempRoot(), { relativePath: "docs/layout.pdf", page: 1 }),
    ).rejects.toThrow("normalization failed");
    expect(page.cleanup).toHaveBeenCalledOnce();
    expect(document.cleanup).toHaveBeenCalledOnce();
    expect(document.destroy).toHaveBeenCalledOnce();
    expect(loadingDestroy).toHaveBeenCalledOnce();
  });

  it("cleans every lifecycle object when persistence fails", async () => {
    const root = tempRoot();
    const outside = createTempPdfProject();
    roots.push(outside);
    symlinkSync(outside, `${root}/.volt-ai`);
    const page = validPage();
    const document = documentMock(page);
    const loadingDestroy = vi.fn(async () => {});
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(document), destroy: loadingDestroy });
    const extractDrawingLayout = await loadExtractor();

    await expect(
      extractDrawingLayout(root, {
        relativePath: "docs/layout.pdf",
        page: 1,
        outputName: "layout",
      }),
    ).rejects.toThrow(/symbolic/i);
    expect(page.cleanup).toHaveBeenCalledOnce();
    expect(document.cleanup).toHaveBeenCalledOnce();
    expect(document.destroy).toHaveBeenCalledOnce();
    expect(loadingDestroy).toHaveBeenCalledOnce();
  });

  it("cleans every lifecycle object on successful extraction", async () => {
    const page = validPage();
    const document = documentMock(page);
    const loadingDestroy = vi.fn(async () => {});
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(document), destroy: loadingDestroy });
    const extractDrawingLayout = await loadExtractor();

    await expect(
      extractDrawingLayout(tempRoot(), { relativePath: "docs/layout.pdf", page: 1 }),
    ).resolves.toMatchObject({ itemCount: 1 });
    expect(page.cleanup).toHaveBeenCalledOnce();
    expect(document.cleanup).toHaveBeenCalledOnce();
    expect(document.destroy).toHaveBeenCalledOnce();
    expect(loadingDestroy).toHaveBeenCalledOnce();
  });

  it("returns valid items and sourceOrder warnings when one raw item is invalid", async () => {
    const page = validPage({
      getTextContent: vi.fn(async () => ({
        items: [
          {
            str: "INVALID",
            transform: [12, 0, 0, 12, 100, 700],
            width: 0,
            height: 12,
            fontName: "FixtureFont",
            dir: "ltr",
            hasEOL: false,
          },
          {
            str: "VALID",
            transform: [12, 0, 0, 12, 200, 700],
            width: 40,
            height: 12,
            fontName: "FixtureFont",
            dir: "ltr",
            hasEOL: false,
          },
        ],
      })),
    });
    const document = documentMock(page);
    const loadingDestroy = vi.fn(async () => {});
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(document), destroy: loadingDestroy });
    const extractDrawingLayout = await loadExtractor();

    await expect(
      extractDrawingLayout(tempRoot(), { relativePath: "docs/layout.pdf", page: 1 }),
    ).resolves.toMatchObject({
      itemCount: 1,
      warnings: ["INVALID_GEOMETRY sourceOrder=0: zero width"],
    });
    expect(page.cleanup).toHaveBeenCalledOnce();
    expect(document.cleanup).toHaveBeenCalledOnce();
    expect(document.destroy).toHaveBeenCalledOnce();
    expect(loadingDestroy).toHaveBeenCalledOnce();
  });

  it("still destroys the loading task when document cleanup fails", async () => {
    const document = documentMock();
    document.cleanup.mockRejectedValue(new Error("cleanup failed"));
    const loadingDestroy = vi.fn(async () => {});
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(document), destroy: loadingDestroy });
    const extractDrawingLayout = await loadExtractor();

    await expect(
      extractDrawingLayout(tempRoot(), { relativePath: "docs/layout.pdf", page: 1 }),
    ).rejects.toThrow("cleanup failed");
    expect(loadingDestroy).toHaveBeenCalledOnce();
  });
});

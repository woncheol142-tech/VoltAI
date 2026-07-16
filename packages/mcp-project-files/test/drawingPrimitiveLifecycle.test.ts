import { rmSync, symlinkSync } from "node:fs";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTempPdfProject, writeProjectFile } from "./helpers/pdfFixture.js";

const pdfMocks = vi.hoisted(() => ({ getDocument: vi.fn() }));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("pdfjs-dist/legacy/build/pdf.mjs")
  >();
  return { ...actual, getDocument: pdfMocks.getDocument };
});

type ExtractDrawingPrimitives = (
  root: string | undefined,
  input: unknown,
) => Promise<unknown>;

const modulePath = "../src/tools/extractDrawingPrimitives.js";
const roots: string[] = [];

async function loadExtractor(): Promise<ExtractDrawingPrimitives> {
  const module = (await import(modulePath)) as {
    extractDrawingPrimitives: ExtractDrawingPrimitives;
  };
  return module.extractDrawingPrimitives;
}

function tempRoot(): string {
  const root = createTempPdfProject();
  roots.push(root);
  writeProjectFile(root, "docs/primitives.pdf", "%PDF-1.7\n%%EOF\n");
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
    getOperatorList: vi.fn(async () => ({
      fnArray: [OPS.constructPath],
      argsArray: [[OPS.stroke, [new Float32Array([0, 10, 20, 1, 110, 20])], new Float32Array([10, 20, 110, 20])]],
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

describe("extractDrawingPrimitives PDF.js lifecycle", () => {
  afterEach(() => {
    pdfMocks.getDocument.mockReset();
    vi.resetModules();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("destroys the loading task when document loading fails", async () => {
    const destroy = vi.fn(async () => {});
    const promise = Promise.reject(new Error("load failed"));
    void promise.catch(() => undefined);
    pdfMocks.getDocument.mockReturnValue({ promise, destroy });

    await expect(
      (await loadExtractor())(tempRoot(), {
        relativePath: "docs/primitives.pdf",
        page: 1,
      }),
    ).rejects.toThrow("load failed");
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("cleans document and loading task when page retrieval fails", async () => {
    const document = documentMock();
    document.getPage.mockRejectedValue(new Error("page failed"));
    const loadingDestroy = vi.fn(async () => {});
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve(document),
      destroy: loadingDestroy,
    });

    await expect(
      (await loadExtractor())(tempRoot(), {
        relativePath: "docs/primitives.pdf",
        page: 1,
      }),
    ).rejects.toThrow("page failed");
    expect(document.cleanup).toHaveBeenCalledOnce();
    expect(document.destroy).toHaveBeenCalledOnce();
    expect(loadingDestroy).toHaveBeenCalledOnce();
  });

  it("cleans page, document, and loading task when operator-list extraction fails", async () => {
    const page = validPage({
      getOperatorList: vi.fn(async () => {
        throw new Error("operator failed");
      }),
    });
    const document = documentMock(page);
    const loadingDestroy = vi.fn(async () => {});
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve(document),
      destroy: loadingDestroy,
    });

    await expect(
      (await loadExtractor())(tempRoot(), {
        relativePath: "docs/primitives.pdf",
        page: 1,
      }),
    ).rejects.toThrow("operator failed");
    expect(page.cleanup).toHaveBeenCalledOnce();
    expect(document.cleanup).toHaveBeenCalledOnce();
    expect(document.destroy).toHaveBeenCalledOnce();
    expect(loadingDestroy).toHaveBeenCalledOnce();
  });

  it("cleans every lifecycle object when decoder access throws", async () => {
    const argsArray: unknown[] = [];
    Object.defineProperty(argsArray, "0", {
      get() {
        throw new Error("decode failed");
      },
    });
    argsArray.length = 1;
    const page = validPage({
      getOperatorList: vi.fn(async () => ({
        fnArray: [OPS.constructPath],
        argsArray,
      })),
    });
    const document = documentMock(page);
    const loadingDestroy = vi.fn(async () => {});
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve(document),
      destroy: loadingDestroy,
    });

    await expect(
      (await loadExtractor())(tempRoot(), {
        relativePath: "docs/primitives.pdf",
        page: 1,
      }),
    ).rejects.toThrow("decode failed");
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
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve(document),
      destroy: loadingDestroy,
    });

    await expect(
      (await loadExtractor())(root, {
        relativePath: "docs/primitives.pdf",
        page: 1,
        outputName: "primitives",
      }),
    ).rejects.toThrow(/symbolic/i);
    expect(page.cleanup).toHaveBeenCalledOnce();
    expect(document.cleanup).toHaveBeenCalledOnce();
    expect(document.destroy).toHaveBeenCalledOnce();
    expect(loadingDestroy).toHaveBeenCalledOnce();
  });

  it("cleans every lifecycle object on success", async () => {
    const page = validPage();
    const document = documentMock(page);
    const loadingDestroy = vi.fn(async () => {});
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve(document),
      destroy: loadingDestroy,
    });

    await expect(
      (await loadExtractor())(tempRoot(), {
        relativePath: "docs/primitives.pdf",
        page: 1,
      }),
    ).resolves.toMatchObject({ primitiveCount: 1 });
    expect(page.cleanup).toHaveBeenCalledOnce();
    expect(document.cleanup).toHaveBeenCalledOnce();
    expect(document.destroy).toHaveBeenCalledOnce();
    expect(loadingDestroy).toHaveBeenCalledOnce();
  });

  it("still destroys the loading task when document cleanup fails", async () => {
    const document = documentMock();
    document.cleanup.mockRejectedValue(new Error("cleanup failed"));
    const loadingDestroy = vi.fn(async () => {});
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve(document),
      destroy: loadingDestroy,
    });

    await expect(
      (await loadExtractor())(tempRoot(), {
        relativePath: "docs/primitives.pdf",
        page: 1,
      }),
    ).rejects.toThrow("cleanup failed");
    expect(loadingDestroy).toHaveBeenCalledOnce();
  });
});

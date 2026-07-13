import { readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createMultiPageTextPdf,
  createTempPdfProject,
  createTextPdf,
  writeProjectFile,
} from "./helpers/pdfFixture.js";

type RenderPdfPageResult = {
  page: number;
  pageCount: number;
  width: number;
  height: number;
  format: "png" | "jpeg";
  relativeImagePath: string;
  mimeType: string;
};

type RenderPdfPage = (
  projectRoot: string | undefined,
  input: unknown,
) => Promise<RenderPdfPageResult>;

const rendererModulePath = "../src/tools/renderPdfPage.js";
const tempRoots: string[] = [];

async function loadRenderPdfPage(): Promise<RenderPdfPage> {
  const module = (await import(rendererModulePath)) as { renderPdfPage: RenderPdfPage };
  return module.renderPdfPage;
}

function createTempProject(): string {
  const root = createTempPdfProject();
  tempRoots.push(root);
  return root;
}

function absoluteOutputPath(root: string, relativeImagePath: string): string {
  return join(root, ...relativeImagePath.split("/"));
}

describe("renderPdfPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("renders a real PNG with default scale 2 and reports actual dimensions", async () => {
    const root = createTempProject();
    writeProjectFile(
      root,
      "docs/spec.pdf",
      createMultiPageTextPdf(["First rendered page", "Second rendered page"]),
    );
    const renderPdfPage = await loadRenderPdfPage();

    const result = await renderPdfPage(root, {
      relativePath: "docs/spec.pdf",
      page: 1,
    });
    const outputPath = absoluteOutputPath(root, result.relativeImagePath);
    const image = readFileSync(outputPath);

    expect(result).toEqual({
      page: 1,
      pageCount: 2,
      width: 1224,
      height: 1584,
      format: "png",
      relativeImagePath: ".volt-ai/rendered/docs/spec-page-001-scale-2.png",
      mimeType: "image/png",
    });
    expect(statSync(outputPath).size).toBeGreaterThan(0);
    expect([...image.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it("renders a real JPEG file", async () => {
    const root = createTempProject();
    writeProjectFile(root, "docs/spec.pdf", createTextPdf("JPEG rendered page"));
    const renderPdfPage = await loadRenderPdfPage();

    const result = await renderPdfPage(root, {
      relativePath: "docs/spec.pdf",
      page: 1,
      scale: 1,
      format: "jpeg",
    });
    const image = readFileSync(absoluteOutputPath(root, result.relativeImagePath));

    expect(result).toMatchObject({
      page: 1,
      pageCount: 1,
      width: 612,
      height: 792,
      format: "jpeg",
      mimeType: "image/jpeg",
    });
    expect(result.relativeImagePath).toBe(".volt-ai/rendered/docs/spec-page-001-scale-1.jpeg");
    expect([...image.subarray(0, 3)]).toEqual([255, 216, 255]);
    expect([...image.subarray(-2)]).toEqual([255, 217]);
  });

  it("uses the same output path for the same normalized input", async () => {
    const root = createTempProject();
    writeProjectFile(root, "docs/spec.pdf", createTextPdf("Stable output"));
    const renderPdfPage = await loadRenderPdfPage();
    const input = { relativePath: "docs/spec.pdf", page: 1, scale: 2, format: "png" } as const;

    const first = await renderPdfPage(root, input);
    const second = await renderPdfPage(root, input);

    expect(second.relativeImagePath).toBe(first.relativeImagePath);
  });

  it("supports Korean and spaces in PDF names while preserving a safe readable file name", async () => {
    const root = createTempProject();
    writeProjectFile(root, "project-files/전기 결합_1_100.pdf", createTextPdf("Korean path"));
    const renderPdfPage = await loadRenderPdfPage();

    const result = await renderPdfPage(root, {
      relativePath: "project-files/전기 결합_1_100.pdf",
      page: 1,
    });

    expect(result.relativeImagePath).toBe(
      ".volt-ai/rendered/project-files/전기_결합_1_100-page-001-scale-2.png",
    );
    expect(statSync(absoluteOutputPath(root, result.relativeImagePath)).size).toBeGreaterThan(0);
  });

  it.each([
    [{ relativePath: "docs/spec.pdf", page: 0 }, "page must be a positive integer"],
    [{ relativePath: "docs/spec.pdf", page: 1.5 }, "page must be a positive integer"],
    [{ relativePath: "docs/spec.pdf", page: 1, scale: 0.99 }, "scale must be between 1 and 4"],
    [{ relativePath: "docs/spec.pdf", page: 1, scale: 4.01 }, "scale must be between 1 and 4"],
    [{ relativePath: "docs/spec.pdf", page: 1, scale: Number.NaN }, "scale must be between 1 and 4"],
    [{ relativePath: "docs/spec.pdf", page: 1, format: "webp" }, "format must be png or jpeg"],
  ])("rejects invalid render input %#", async (input, message) => {
    const root = createTempProject();
    writeProjectFile(root, "docs/spec.pdf", createTextPdf("Validation"));
    const renderPdfPage = await loadRenderPdfPage();

    await expect(renderPdfPage(root, input)).rejects.toThrow(message);
  });

  it("rejects a page above the PDF page count", async () => {
    const root = createTempProject();
    writeProjectFile(root, "docs/spec.pdf", createMultiPageTextPdf(["One", "Two"]));
    const renderPdfPage = await loadRenderPdfPage();

    await expect(
      renderPdfPage(root, { relativePath: "docs/spec.pdf", page: 3 }),
    ).rejects.toThrow("page must be between 1 and 2");
  });

  it("rejects non-PDF, absolute, traversal, and hidden input paths", async () => {
    const root = createTempProject();
    writeProjectFile(root, "docs/spec.txt", "not pdf");
    writeProjectFile(root, ".hidden/spec.pdf", createTextPdf("hidden"));
    const renderPdfPage = await loadRenderPdfPage();
    const absolutePath = join(root, "docs/spec.pdf");
    expect(isAbsolute(absolutePath)).toBe(true);

    await expect(
      renderPdfPage(root, { relativePath: "docs/spec.txt", page: 1 }),
    ).rejects.toThrow("Only .pdf files are supported");
    await expect(renderPdfPage(root, { relativePath: absolutePath, page: 1 })).rejects.toThrow(
      "relativePath must be relative",
    );
    await expect(
      renderPdfPage(root, { relativePath: "../secret.pdf", page: 1 }),
    ).rejects.toThrow("relativePath must stay within PROJECT_ROOT");
    await expect(
      renderPdfPage(root, { relativePath: ".hidden/spec.pdf", page: 1 }),
    ).rejects.toThrow("relativePath cannot include hidden folders or node_modules");
  });

  it("rejects source symlinks that resolve outside PROJECT_ROOT", async () => {
    const root = createTempProject();
    const outside = createTempProject();
    writeProjectFile(outside, "secret.pdf", createTextPdf("Outside"));
    symlinkSync(join(outside, "secret.pdf"), join(root, "linked.pdf"));
    const renderPdfPage = await loadRenderPdfPage();

    await expect(renderPdfPage(root, { relativePath: "linked.pdf", page: 1 })).rejects.toThrow(
      "relativePath must stay within PROJECT_ROOT",
    );
  });

  it("does not follow a rendered-output directory symlink outside PROJECT_ROOT", async () => {
    const root = createTempProject();
    const outside = createTempProject();
    writeProjectFile(root, "docs/spec.pdf", createTextPdf("Safe output"));
    symlinkSync(outside, join(root, ".volt-ai"), "dir");
    const renderPdfPage = await loadRenderPdfPage();

    await expect(renderPdfPage(root, { relativePath: "docs/spec.pdf", page: 1 })).rejects.toThrow(
      "Rendered output path cannot include symbolic links",
    );
    expect(statSync(outside).isDirectory()).toBe(true);
  });

  it("does not write application logs to stdout", async () => {
    const root = createTempProject();
    writeProjectFile(root, "docs/spec.pdf", createTextPdf("Quiet rendering"));
    const stdoutLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const renderPdfPage = await loadRenderPdfPage();

    await renderPdfPage(root, { relativePath: "docs/spec.pdf", page: 1 });

    expect(stdoutLog).not.toHaveBeenCalled();
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = join(testDirectory, "..", "src");

describe("evidence pipeline cleanup", () => {
  it("does not use legacy PDF text fallback or sourcePath string sniffing", () => {
    const designItemsSource = readFileSync(join(sourceDirectory, "designItems.ts"), "utf8");
    const reportSource = readFileSync(join(sourceDirectory, "report.ts"), "utf8");

    expect(designItemsSource).not.toContain("pdf.pages &&");
    expect(designItemsSource).not.toContain("excerpt: `${pdf.relativePath}: ${line}`");
    expect(reportSource).not.toContain("startsWith");
  });
});

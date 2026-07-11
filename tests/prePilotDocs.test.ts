import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("pre-pilot documentation contract", () => {
  it("documents the implemented generic, Company, and Material knowledge layers", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");

    for (const expected of [
      "knowledge-core",
      "knowledge-sqlite",
      "knowledge-company",
      "knowledge-material",
      "index_company",
      "search_company",
      "index_material",
      "search_material",
      "Company Knowledge",
    ]) {
      expect(readme).toContain(expected);
    }
    expect(readme).not.toContain("mcp-material          Scaffold placeholder package");
    expect(readme).not.toContain("Test Files: 18 passed");
    expect(readme).not.toContain("Tests: 123 passed");
  });

  it("states that the KEC embedding provider must be selected explicitly", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const environment = readFileSync(join(root, ".env.example"), "utf8");

    expect(readme).toContain("KEC_EMBED_PROVIDER is required");
    expect(readme).toContain("placeholder is intended for offline tests");
    expect(environment).toContain("KEC_EMBED_PROVIDER=ollama");
  });

  it("documents dist-independent clean checkout and pre-pilot regression suites", () => {
    const testing = readFileSync(join(root, "TESTING.md"), "utf8");

    for (const expected of [
      "Clean checkout",
      "build before test",
      "dist-independent",
      "Material multi-sheet",
      "Company placeholder selection",
      "KEC provider fail-closed",
    ]) {
      expect(testing).toContain(expected);
    }
  });
});

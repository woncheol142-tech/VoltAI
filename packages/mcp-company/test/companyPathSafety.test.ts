import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  companyMcpEnvironment,
  connectInMemoryMcp,
  createCompanyMcpFixture,
  createOutsideSymlink,
  loadMcpCompany,
  readToolText,
  writeProjectFile,
  type CompanyMcpFixture,
} from "./helpers/companyMcpHarness.js";

const fixtures: CompanyMcpFixture[] = [];

function createFixture(): CompanyMcpFixture {
  const fixture = createCompanyMcpFixture();
  fixtures.push(fixture);
  return fixture;
}

async function callIndex(fixture: CompanyMcpFixture, relativePath: string) {
  const { createServer } = await loadMcpCompany();
  const connection = await connectInMemoryMcp(
    createServer({ environment: companyMcpEnvironment(fixture) }),
  );

  try {
    return await connection.client.callTool({
      name: "index_company",
      arguments: {
        relativePath,
        standardId: "CS-ELEC-001",
        title: "Electrical Design Standard",
      },
    });
  } finally {
    await connection.close();
  }
}

describe("index_company PROJECT_ROOT safety", () => {
  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.cleanup();
    }
  });

  it("allows a PDF whose real path stays inside PROJECT_ROOT", async () => {
    const fixture = createFixture();
    const response = await callIndex(fixture, fixture.pdfRelativePath);

    expect(response.isError).not.toBe(true);
  }, 15_000);

  it("rejects an absolute PDF path", async () => {
    const fixture = createFixture();

    const response = await callIndex(
      fixture,
      join(fixture.projectRoot, fixture.pdfRelativePath),
    );

    expect(response.isError).toBe(true);
    expect(readToolText(response)).toContain("relativePath must be relative");
  });

  it("rejects traversal outside PROJECT_ROOT", async () => {
    const fixture = createFixture();

    const response = await callIndex(fixture, "../outside.pdf");

    expect(response.isError).toBe(true);
    expect(readToolText(response)).toContain("relativePath must stay within PROJECT_ROOT");
  });

  it("rejects non-PDF input", async () => {
    const fixture = createFixture();
    writeProjectFile(
      fixture.projectRoot,
      "standards/standard.txt",
      "not a PDF",
    );

    const response = await callIndex(fixture, "standards/standard.txt");

    expect(response.isError).toBe(true);
    expect(readToolText(response)).toContain("Only .pdf files are supported");
  });

  it("rejects a missing PDF", async () => {
    const fixture = createFixture();

    const response = await callIndex(fixture, "standards/missing.pdf");

    expect(response.isError).toBe(true);
    expect(readToolText(response)).toContain("PDF file does not exist");
  });

  it("rejects a symlink whose real path escapes PROJECT_ROOT", async () => {
    const fixture = createFixture();
    const relativePath = createOutsideSymlink(fixture);

    const response = await callIndex(fixture, relativePath);

    expect(response.isError).toBe(true);
    expect(readToolText(response)).toContain("relativePath must stay within PROJECT_ROOT");
  });
});

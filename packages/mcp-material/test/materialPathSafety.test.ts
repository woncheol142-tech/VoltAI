import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  connectInMemoryMcp,
  createMaterialMcpFixture,
  createOutsideSymlink,
  loadMcpMaterial,
  materialMcpEnvironment,
  readToolText,
  type MaterialMcpFixture,
} from "./helpers/materialMcpHarness.js";

const fixtures: MaterialMcpFixture[] = [];
const columnMap = { itemCode: "Item Code", name: "Name" };

async function createFixture(): Promise<MaterialMcpFixture> {
  const fixture = await createMaterialMcpFixture();
  fixtures.push(fixture);
  return fixture;
}

async function callIndex(
  fixture: MaterialMcpFixture,
  relativePath: string,
  sheetName?: string,
) {
  const { createServer } = await loadMcpMaterial();
  const connection = await connectInMemoryMcp(
    createServer({ environment: materialMcpEnvironment(fixture) }),
  );

  try {
    return await connection.client.callTool({
      name: "index_material",
      arguments: {
        relativePath,
        catalogId: "CAT-ELEC-001",
        columnMap,
        sheetName,
      },
    });
  } finally {
    await connection.close();
  }
}

describe("index_material PROJECT_ROOT safety", () => {
  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.cleanup();
    }
  });

  it("allows an XLSX whose real path stays under PROJECT_ROOT", async () => {
    const fixture = await createFixture();
    const response = await callIndex(fixture, fixture.xlsxRelativePath);

    expect(response.isError).not.toBe(true);
  }, 15_000);

  it("rejects absolute and traversal paths", async () => {
    const fixture = await createFixture();
    const absolute = await callIndex(
      fixture,
      join(fixture.projectRoot, fixture.xlsxRelativePath),
    );
    const traversal = await callIndex(fixture, "../outside.xlsx");

    expect(absolute.isError).toBe(true);
    expect(readToolText(absolute)).toContain("relativePath must be relative");
    expect(traversal.isError).toBe(true);
    expect(readToolText(traversal)).toContain(
      "relativePath must stay within PROJECT_ROOT",
    );
  });

  it("rejects non-XLSX and legacy XLS inputs", async () => {
    const fixture = await createFixture();
    writeFileSync(
      join(fixture.projectRoot, "catalogs", "materials.csv"),
      "Item Code,Name",
    );
    writeFileSync(
      join(fixture.projectRoot, "catalogs", "materials.xls"),
      "legacy binary",
    );

    const csv = await callIndex(fixture, "catalogs/materials.csv");
    const xls = await callIndex(fixture, "catalogs/materials.xls");

    expect(csv.isError).toBe(true);
    expect(readToolText(csv)).toContain("Only .xlsx files are supported");
    expect(xls.isError).toBe(true);
    expect(readToolText(xls)).toContain("Only .xlsx files are supported");
  });

  it("rejects missing files and symlinks that escape PROJECT_ROOT", async () => {
    const fixture = await createFixture();
    const missing = await callIndex(fixture, "catalogs/missing.xlsx");
    const symlink = await callIndex(fixture, createOutsideSymlink(fixture));

    expect(missing.isError).toBe(true);
    expect(readToolText(missing)).toContain("Excel file does not exist");
    expect(symlink.isError).toBe(true);
    expect(readToolText(symlink)).toContain(
      "relativePath must stay within PROJECT_ROOT",
    );
  });

  it("returns a clear error when the selected sheet is absent", async () => {
    const fixture = await createFixture();
    const response = await callIndex(
      fixture,
      fixture.xlsxRelativePath,
      "Missing",
    );

    expect(response.isError).toBe(true);
    expect(readToolText(response)).toContain("Sheet not found");
  });
});

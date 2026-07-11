import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export { connectInMemoryMcp } from "../../../mcp-agent/test/e2e/helpers/mcpHarness.js";

export type CompanyMcpFixture = {
  projectRoot: string;
  dbPath: string;
  pdfRelativePath: string;
  outsideRoot: string;
  cleanup: () => void;
};

function escapePdfText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

export function createTextPdf(pageTexts: string[]): string {
  const pageObjects = pageTexts.map((_text, index) => {
    const contentObjectNumber = 4 + pageTexts.length + index;

    return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`;
  });
  const contentObjects = pageTexts.map((text) => {
    const stream = `BT /F1 18 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`;

    return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  const pageReferences = pageObjects
    .map((_, index) => `${4 + index} 0 R`)
    .join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageReferences}] /Count ${pageTexts.length} >>`,
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

export function writeProjectFile(
  projectRoot: string,
  relativePath: string,
  content: string,
): void {
  const filePath = join(projectRoot, ...relativePath.split("/"));
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

export function createCompanyMcpFixture(): CompanyMcpFixture {
  const projectRoot = mkdtempSync(join(tmpdir(), "voltai-mcp-company-"));
  const outsideRoot = mkdtempSync(
    join(tmpdir(), "voltai-mcp-company-outside-"),
  );
  const pdfRelativePath = "standards/electrical-standard.pdf";
  const dbPath = join(projectRoot, ".voltai", "company-test.sqlite");

  writeProjectFile(
    projectRoot,
    pdfRelativePath,
    createTextPdf([
      "Company grounding conductors shall be bonded at the main panel.",
      "Procurement records shall be retained by the purchasing department.",
    ]),
  );
  writeProjectFile(
    outsideRoot,
    "outside.pdf",
    createTextPdf(["Outside project root."]),
  );

  return {
    projectRoot,
    dbPath,
    pdfRelativePath,
    outsideRoot,
    cleanup: () => {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    },
  };
}

export function createOutsideSymlink(fixture: CompanyMcpFixture): string {
  const relativePath = "standards/outside-link.pdf";
  const linkPath = join(fixture.projectRoot, ...relativePath.split("/"));
  mkdirSync(dirname(linkPath), { recursive: true });
  symlinkSync(join(fixture.outsideRoot, "outside.pdf"), linkPath);

  return relativePath;
}

export function companyMcpEnvironment(
  fixture: CompanyMcpFixture,
): Record<string, string> {
  return {
    PROJECT_ROOT: fixture.projectRoot,
    KNOWLEDGE_DB_PATH: fixture.dbPath,
    COMPANY_EMBED_PROVIDER: "placeholder",
  };
}

export function readToolText(result: unknown): string {
  if (
    typeof result !== "object" ||
    result === null ||
    !("content" in result) ||
    !Array.isArray(result.content)
  ) {
    throw new Error("MCP result content is missing");
  }

  const first = result.content[0] as
    { type?: unknown; text?: unknown } | undefined;

  if (first?.type !== "text" || typeof first.text !== "string") {
    throw new Error("MCP result did not contain text");
  }

  return first.text;
}

export async function loadMcpCompany() {
  return import("../../../mcp-company/src/index.js");
}

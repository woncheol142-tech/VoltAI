import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createTempPdfProject(): string {
  return mkdtempSync(join(tmpdir(), "voltai-project-pdf-"));
}

export function writeProjectFile(
  root: string,
  relativePath: string,
  content: string | Uint8Array,
): void {
  const parts = relativePath.split("/");
  const fileName = parts.pop();

  if (!fileName) {
    throw new Error("relativePath must include a file name");
  }

  mkdirSync(join(root, ...parts), { recursive: true });
  writeFileSync(join(root, ...parts, fileName), content);
}

function escapePdfText(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

export function createTextPdf(text: string): string {
  return createMultiPageTextPdf([text]);
}

export function createMultiPageTextPdf(pageTexts: string[]): string {
  const pageObjects = pageTexts.map((_, index) => {
    const contentObjectNumber = 4 + pageTexts.length + index;

    return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`;
  });
  const contentObjects = pageTexts.map((text) => {
    const stream = `BT /F1 18 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`;

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

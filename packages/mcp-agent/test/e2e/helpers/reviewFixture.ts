import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  MockReviewLlm,
  createReviewReport,
  type ReviewPromptInput,
  type ReviewReport,
} from "@voltai/agent-review";
import type { EmbeddingProvider } from "@voltai/mcp-kec";
import ExcelJS from "exceljs";

const fixedTimestamp = new Date("2026-01-01T00:00:00.000Z");
const environmentKeys = [
  "PROJECT_ROOT",
  "KEC_DB_PATH",
  "KEC_EMBED_PROVIDER",
  "REVIEW_LLM_PROVIDER",
  "REVIEW_LLM_FALLBACK",
  "REVIEW_LLM_MODEL",
  "ZAI_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

type ManagedEnvironmentKey = (typeof environmentKeys)[number];

export type ReviewFixture = {
  projectRoot: string;
  kecDbPath: string;
  embeddingProvider: EmbeddingProvider;
  cleanup: () => Promise<void>;
};

class DeterministicEmbeddingProvider implements EmbeddingProvider {
  getMetadata() {
    return {
      provider: "e2e",
      model: "keyword-v1",
    };
  }

  async embed(text: string): Promise<number[]> {
    const normalized = text.toLowerCase();

    return [
      normalized.includes("cable") || normalized.includes("케이블") ? 1 : 0,
      normalized.includes("ground") || normalized.includes("접지") ? 1 : 0,
      normalized.includes("breaker") || normalized.includes("차단기") ? 1 : 0,
      normalized.length > 0 ? 1 : 0,
    ];
  }
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function createTextPdf(pageTexts: string[]): string {
  const pageObjects = pageTexts.map((_text, index) => {
    const contentObjectNumber = 4 + pageTexts.length + index;

    return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`;
  });
  const contentObjects = pageTexts.map((text) => {
    const stream = `BT /F1 18 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`;

    return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  const pageReferences = pageObjects.map((_, index) => `${4 + index} 0 R`).join(" ");
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

function writePdf(root: string, relativePath: string, pageTexts: string[]): void {
  const filePath = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, createTextPdf(pageTexts));
  utimesSync(filePath, fixedTimestamp, fixedTimestamp);
}

async function writeLoadSchedule(root: string): Promise<void> {
  const relativePath = "estimates/load-schedule.xlsx";
  const filePath = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(filePath), { recursive: true });

  const workbook = new ExcelJS.Workbook();
  workbook.created = fixedTimestamp;
  workbook.modified = fixedTimestamp;

  const summary = workbook.addWorksheet("Summary");
  summary.addRow(["Item", "Description"]);
  summary.addRow(["MCCB", "Main breaker load calculation"]);

  for (let rowIndex = 3; rowIndex <= 51; rowIndex += 1) {
    summary.addRow([`Circuit ${rowIndex - 2}`, "Load schedule item"]);
  }

  const notes = workbook.addWorksheet("Notes");
  notes.addRow(["Note"]);
  notes.addRow(["Review the secondary feeder separately"]);

  await workbook.xlsx.writeFile(filePath);
  utimesSync(filePath, fixedTimestamp, fixedTimestamp);
}

function setEnvironmentValue(name: ManagedEnvironmentKey, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

export class CapturingMockReviewLlm extends MockReviewLlm {
  report: ReviewReport | undefined;
  input: ReviewPromptInput | undefined;

  override async generateReview(input: ReviewPromptInput): Promise<string> {
    this.input = input;
    this.report = createReviewReport(input);

    return super.generateReview(input);
  }
}

export function createCapturingMockReviewLlm(): CapturingMockReviewLlm {
  return new CapturingMockReviewLlm();
}

export async function createReviewFixture(): Promise<ReviewFixture> {
  const projectRoot = mkdtempSync(join(tmpdir(), "voltai-review-e2e-"));
  const kecDbPath = join(projectRoot, ".voltai", "e2e-kec.sqlite");

  writePdf(projectRoot, "docs/electrical-spec.pdf", [
    "Main cable and voltage drop calculation.",
    "Panel grounding arrangement.",
  ]);
  writePdf(projectRoot, "knowledge/kec-source.pdf", [
    "KEC 232.5 cable sizing requirement for breaker and grounding.",
    "Obsolete KEC source content.",
  ]);
  await writeLoadSchedule(projectRoot);

  return {
    projectRoot,
    kecDbPath,
    embeddingProvider: new DeterministicEmbeddingProvider(),
    cleanup: async () => {
      rmSync(projectRoot, { recursive: true, force: true });
    },
  };
}

export function rewriteKecSourcePdf(fixture: ReviewFixture): void {
  writePdf(fixture.projectRoot, "knowledge/kec-source.pdf", [
    "KEC 232.5 cable sizing requirement for breaker and grounding.",
  ]);
}

export async function withE2eEnvironment<T>(
  fixture: ReviewFixture,
  operation: () => Promise<T>,
): Promise<T> {
  const snapshot = new Map<ManagedEnvironmentKey, string | undefined>(
    environmentKeys.map((key) => [key, process.env[key]]),
  );

  setEnvironmentValue("PROJECT_ROOT", fixture.projectRoot);
  setEnvironmentValue("KEC_DB_PATH", fixture.kecDbPath);
  setEnvironmentValue("KEC_EMBED_PROVIDER", "placeholder");
  setEnvironmentValue("REVIEW_LLM_PROVIDER", "mock");
  setEnvironmentValue("REVIEW_LLM_FALLBACK", "none");
  setEnvironmentValue("REVIEW_LLM_MODEL", undefined);
  setEnvironmentValue("ZAI_API_KEY", undefined);
  setEnvironmentValue("OPENAI_API_KEY", undefined);
  setEnvironmentValue("OPENROUTER_API_KEY", undefined);

  try {
    return await operation();
  } finally {
    for (const key of environmentKeys) {
      setEnvironmentValue(key, snapshot.get(key));
    }
  }
}

export function normalizeMarkdown(markdown: string, projectRoot: string): string {
  return markdown.replaceAll(projectRoot, "<PROJECT_ROOT>");
}

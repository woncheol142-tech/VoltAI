import type {
  DesignItemReview,
  ExcelReadResult,
  KecSearchResult,
  PdfReadResult,
  ProjectFile,
  ReviewFinding,
  ReviewProjectPorts,
} from "./ports.js";
import { extractDesignItems } from "./designItems.js";
import { analyzeDesignItemRelations } from "./designRelations.js";

export type ReviewProjectInput = {
  projectPath: string;
};

function assertReviewProjectInput(input: ReviewProjectInput): void {
  if (!input.projectPath) {
    throw new Error("projectPath is required");
  }
}

function isPdf(file: ProjectFile): boolean {
  return file.extension.toLowerCase() === ".pdf";
}

function isExcel(file: ProjectFile): boolean {
  const extension = file.extension.toLowerCase();
  return extension === ".xlsx" || extension === ".xls";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function buildKecQuestion(pdfs: PdfReadResult[], excels: ExcelReadResult[]): string {
  const pdfText = pdfs.map((pdf) => pdf.text).join("\n");
  const excelText = excels
    .flatMap((excel) => excel.rows ?? [])
    .flat()
    .filter((value) => value !== null && value !== undefined)
    .join(" ");

  const source = `${pdfText}\n${excelText}`.trim();

  return source.length > 0 ? source.slice(0, 500) : "전기 설계 검토 관련 KEC 조항";
}

export async function reviewProject(
  input: ReviewProjectInput,
  ports: ReviewProjectPorts,
): Promise<string> {
  try {
    assertReviewProjectInput(input);

    const files = await ports.listProjectFiles(input.projectPath);
    const pdfs: PdfReadResult[] = [];
    const excels: ExcelReadResult[] = [];
    const findings: ReviewFinding[] = [];

    for (const file of files.filter(isPdf)) {
      try {
        pdfs.push(await ports.readPdf(file.relativePath));
      } catch (error) {
        findings.push({
          severity: "warning",
          message: `${file.relativePath}: ${errorMessage(error)}`,
        });
      }
    }

    for (const file of files.filter(isExcel)) {
      try {
        excels.push(await ports.readExcel(file.relativePath));
      } catch (error) {
        findings.push({
          severity: "warning",
          message: `${file.relativePath}: ${errorMessage(error)}`,
        });
      }
    }

    let kecResults: KecSearchResult[] = [];

    try {
      kecResults = await ports.searchKec(buildKecQuestion(pdfs, excels));
    } catch (error) {
      findings.push({
        severity: "warning",
        message: `KEC search: ${errorMessage(error)}`,
      });
    }

    const itemReviews: DesignItemReview[] = [];
    const designItems = extractDesignItems({ pdfs, excels });
    const relationFindings = analyzeDesignItemRelations(designItems);

    for (const item of designItems) {
      const itemFindings: ReviewFinding[] = relationFindings
        .filter((finding) => finding.items.includes(item.name))
        .map((finding) => ({
          severity: "warning",
          message: `${finding.message} (severity: ${finding.severity}, confidence: ${finding.confidence}, proximity: ${finding.proximity})`,
        }));
      let itemKecResults: KecSearchResult[] = [];

      try {
        itemKecResults = (await ports.searchKec(`${item.name} KEC 기준`)) ?? [];
      } catch (error) {
        itemFindings.push({
          severity: "warning",
          message: errorMessage(error),
        });
      }

      itemReviews.push({
        name: item.name,
        evidence: item.evidence,
        kecResults: itemKecResults,
        findings: itemFindings,
      });
    }

    return ports.llm.generateReview({
      projectPath: input.projectPath,
      files,
      pdfs,
      excels,
      kecResults,
      itemReviews,
      findings,
    });
  } finally {
    await ports.close?.();
  }
}

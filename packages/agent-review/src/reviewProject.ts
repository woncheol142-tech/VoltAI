import type {
  DesignItemReview,
  ExcelReadResult,
  KecSearchResult,
  PdfReadResult,
  ProjectFile,
  ReviewFinding,
  ReviewProjectPorts,
} from "./ports.js";
import type { CompanySearchResult } from "@voltai/knowledge-company";
import { extractDesignItems } from "./designItems.js";
import { analyzeDesignItemRelations } from "./designRelations.js";
import { createReviewKnowledgeQueryService } from "./reviewKnowledgeQueries.js";

export type ReviewProjectInput = {
  projectPath: string;
  ingestionPolicy?: ReviewIngestionPolicy;
};

export type ReviewIngestionPolicy = {
  excel: {
    sheetSelection: "first";
    maxRowsPerSheet: number;
  };
  pdf: {
    maxCharsPerFile?: number;
  };
  coverageWarnings: boolean;
};

export const defaultReviewIngestionPolicy: ReviewIngestionPolicy = {
  excel: {
    sheetSelection: "first",
    maxRowsPerSheet: 50,
  },
  pdf: {},
  coverageWarnings: true,
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

function resolveReviewIngestionPolicy(input: ReviewProjectInput): ReviewIngestionPolicy {
  return input.ingestionPolicy ?? defaultReviewIngestionPolicy;
}

function addCoverageWarning(
  findings: ReviewFinding[],
  policy: ReviewIngestionPolicy,
  message: string,
): void {
  if (!policy.coverageWarnings) {
    return;
  }

  findings.push({
    severity: "warning",
    message,
  });
}

async function readPdfWithPolicy(
  file: ProjectFile,
  ports: ReviewProjectPorts,
  policy: ReviewIngestionPolicy,
  findings: ReviewFinding[],
): Promise<PdfReadResult> {
  const options =
    policy.pdf.maxCharsPerFile === undefined
      ? undefined
      : { maxChars: policy.pdf.maxCharsPerFile };
  const pdf = await ports.readPdf(file.relativePath, options);

  if (policy.pdf.maxCharsPerFile !== undefined && pdf.truncated === true) {
    addCoverageWarning(
      findings,
      policy,
      `${file.relativePath} was limited to ${policy.pdf.maxCharsPerFile} characters`,
    );
  }

  return pdf;
}

async function readExcelWithPolicy(
  file: ProjectFile,
  ports: ReviewProjectPorts,
  policy: ReviewIngestionPolicy,
  findings: ReviewFinding[],
): Promise<ExcelReadResult> {
  const workbook = await ports.readExcel(file.relativePath);
  const selectedSheet = workbook.sheets[0];

  if (!selectedSheet) {
    return workbook;
  }

  if (workbook.sheets.length > 1) {
    addCoverageWarning(
      findings,
      policy,
      `${file.relativePath} has ${workbook.sheets.length} sheets; reviewed first sheet only: ${selectedSheet}`,
    );
  }

  const excel = await ports.readExcel(file.relativePath, {
    sheetName: selectedSheet,
    maxRows: policy.excel.maxRowsPerSheet,
  });

  if (excel.totalRows !== undefined && excel.totalRows > (excel.rows?.length ?? 0)) {
    addCoverageWarning(
      findings,
      policy,
      `${file.relativePath} [${selectedSheet}] was limited to ${policy.excel.maxRowsPerSheet} rows`,
    );
  }

  return excel;
}

export async function reviewProject(
  input: ReviewProjectInput,
  ports: ReviewProjectPorts,
): Promise<string> {
  try {
    assertReviewProjectInput(input);
    const ingestionPolicy = resolveReviewIngestionPolicy(input);

    const files = await ports.listProjectFiles(input.projectPath);
    const pdfs: PdfReadResult[] = [];
    const excels: ExcelReadResult[] = [];
    const findings: ReviewFinding[] = [];
    const knowledgeQueries = createReviewKnowledgeQueryService(ports);

    for (const file of files.filter(isPdf)) {
      try {
        pdfs.push(await readPdfWithPolicy(file, ports, ingestionPolicy, findings));
      } catch (error) {
        findings.push({
          severity: "warning",
          message: `${file.relativePath}: ${errorMessage(error)}`,
        });
      }
    }

    for (const file of files.filter(isExcel)) {
      try {
        excels.push(await readExcelWithPolicy(file, ports, ingestionPolicy, findings));
      } catch (error) {
        findings.push({
          severity: "warning",
          message: `${file.relativePath}: ${errorMessage(error)}`,
        });
      }
    }

    let kecResults: KecSearchResult[] = [];
    let companyResults: CompanySearchResult[] = [];
    const projectKecQuestion = buildKecQuestion(pdfs, excels);

    try {
      const knowledgeResults = await knowledgeQueries.searchProject({
        context: projectKecQuestion,
      });
      kecResults = knowledgeResults.kecResults;
      companyResults = knowledgeResults.companyResults;
      findings.push(...knowledgeResults.warnings.map((warning) => ({
        severity: warning.severity,
        message: warning.message,
      })));
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
      let itemCompanyResults: CompanySearchResult[] = [];

      try {
        const knowledgeResults = await knowledgeQueries.searchItem({
          name: item.name,
          evidence: item.evidence,
        });
        itemKecResults = knowledgeResults.kecResults;
        itemCompanyResults = knowledgeResults.companyResults;
        itemFindings.push(...knowledgeResults.warnings.map((warning) => ({
          severity: warning.severity,
          message: warning.message,
        })));
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
        companyResults: itemCompanyResults,
        findings: itemFindings,
      });
    }

    return ports.llm.generateReview({
      projectPath: input.projectPath,
      files,
      pdfs,
      excels,
      kecResults,
      companyResults,
      itemReviews,
      findings,
    });
  } finally {
    await ports.close?.();
  }
}

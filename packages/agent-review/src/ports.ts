export type ProjectFile = {
  name: string;
  relativePath: string;
  extension: string;
  size: number;
  modifiedAt: string;
};

export type PdfReadResult = {
  relativePath: string;
  pageCount: number;
  text: string;
  pages: Array<{
    page: number;
    text: string;
  }>;
  truncated?: boolean;
};

export type ExcelReadResult = {
  relativePath: string;
  sheets: string[];
  sheetName?: string;
  rows?: unknown[][];
  totalRows?: number;
};

export type KecSearchResult = {
  clause: string | null;
  page: number;
  text: string;
  similarity: number;
  sourcePath: string;
};

export type EvidenceBase = {
  id: string;
  sourcePath: string;
  excerpt: string;
};

export type PdfEvidence = EvidenceBase & {
  sourceType: "pdf";
  page: number;
};

export type ExcelEvidence = EvidenceBase & {
  sourceType: "excel";
  sheetName?: string;
  rowIndex: number;
};

export type CadEvidence = EvidenceBase & {
  sourceType: "cad";
};

export type UnknownEvidence = EvidenceBase & {
  sourceType: "unknown";
};

export type StructuredEvidence =
  | PdfEvidence
  | ExcelEvidence
  | CadEvidence
  | UnknownEvidence;

export type KecCitation = EvidenceBase & {
  sourceType: "kec";
  page: number;
  label: string;
};

export type Citation = StructuredEvidence | KecCitation;

export type ReviewFinding = {
  severity: "info" | "warning";
  message: string;
};

export type CoverageFinding = {
  id: string;
  severity: "info" | "warning";
  file: string;
  reviewed?: number;
  total?: number;
  reason: "pdf-truncated" | "sheet-selection" | "row-limit" | "read-error" | "kec-search";
  message: string;
};

export type DesignItemReview = {
  name: string;
  evidence: StructuredEvidence[];
  kecResults: KecSearchResult[];
  findings: ReviewFinding[];
};

export type ReviewPromptInput = {
  projectPath: string;
  files: ProjectFile[];
  pdfs: PdfReadResult[];
  excels: ExcelReadResult[];
  kecResults: KecSearchResult[];
  itemReviews: DesignItemReview[];
  findings: ReviewFinding[];
};

export type ReviewLlm = {
  generateReview: (input: ReviewPromptInput) => Promise<string>;
};

export type ReviewProjectPorts = {
  listProjectFiles: (projectPath: string) => Promise<ProjectFile[]>;
  readPdf: (relativePath: string, options?: { maxChars?: number }) => Promise<PdfReadResult>;
  readExcel: (
    relativePath: string,
    options?: { sheetName?: string; maxRows?: number },
  ) => Promise<ExcelReadResult>;
  searchKec: (question: string) => Promise<KecSearchResult[]>;
  llm: ReviewLlm;
  close?: () => Promise<void> | void;
};

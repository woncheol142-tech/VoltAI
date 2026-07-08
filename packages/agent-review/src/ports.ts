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
};

export type ExcelReadResult = {
  relativePath: string;
  sheets: string[];
  sheetName?: string;
  rows?: unknown[][];
};

export type KecSearchResult = {
  clause: string | null;
  page: number;
  text: string;
  similarity: number;
  sourcePath: string;
};

export type StructuredEvidence = {
  sourceType: "pdf" | "excel" | "cad" | "unknown";
  sourcePath: string;
  page?: number;
  sheetName?: string;
  rowIndex?: number;
  excerpt: string;
};

export type ReviewFinding = {
  severity: "info" | "warning";
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
  readPdf: (relativePath: string) => Promise<PdfReadResult>;
  readExcel: (relativePath: string) => Promise<ExcelReadResult>;
  searchKec: (question: string) => Promise<KecSearchResult[]>;
  llm: ReviewLlm;
};

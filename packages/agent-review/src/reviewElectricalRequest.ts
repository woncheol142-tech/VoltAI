import type { CompanySearchResult } from "@voltai/knowledge-company";

import { drawingRequestQuery } from "./drawingRequestQuery.js";
import type {
  ElectricalDrawingCandidate,
  ElectricalDrawingPage,
  ElectricalReviewPorts,
} from "./electricalReviewPorts.js";
import { createReviewKnowledgeQueryService } from "./reviewKnowledgeQueries.js";
import { toKecCitation } from "./report.js";
import type {
  DesignItemReview,
  KecCitation,
  PdfEvidence,
  PdfReadResult,
  ReviewFinding,
  ReviewPromptInput,
} from "./ports.js";

export type ElectricalReviewRequestInput = {
  projectPath: string;
  request: string;
};

export type ElectricalReviewSelection = "selected" | "ambiguous" | "not-found";

export type ElectricalSelectedDrawing = ElectricalDrawingCandidate & {
  sourcePath: string;
  page: number | null;
};

export type ElectricalReviewResult = {
  selection: ElectricalReviewSelection;
  drawingQuery: string;
  candidates: ElectricalDrawingCandidate[];
  selectedDrawings: ElectricalSelectedDrawing[];
  warnings: string[];
  kecCitations: KecCitation[];
  markdown?: string;
};

function assertInput(input: ElectricalReviewRequestInput): void {
  if (typeof input.projectPath !== "string" || input.projectPath.length === 0) {
    throw new Error("projectPath is required");
  }
  if (typeof input.request !== "string" || input.request.trim().length === 0) {
    throw new Error("request is required");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function selectedDrawing(
  candidate: ElectricalDrawingCandidate,
  sourcePath: string,
): ElectricalSelectedDrawing {
  return {
    ...candidate,
    sourcePath,
    page: candidate.drawingPage ?? null,
  };
}

function drawingIdentity(candidate: ElectricalDrawingCandidate): string {
  return [
    candidate.drawingNo,
    candidate.title,
    candidate.building,
    candidate.floor,
    candidate.category,
  ]
    .filter((value): value is string => value !== null && value.length > 0)
    .join(" — ");
}

function pageEvidence(
  drawing: ElectricalSelectedDrawing,
  page: ElectricalDrawingPage,
): PdfEvidence {
  return {
    id: `pdf:${page.sourcePath}:p${page.page}:drawing:${drawing.drawingNo}`,
    sourceType: "pdf",
    sourcePath: page.sourcePath,
    page: page.page,
    excerpt: page.text,
  };
}

function pdfInput(page: ElectricalDrawingPage): PdfReadResult {
  return {
    relativePath: page.sourcePath,
    pageCount: page.pageCount,
    text: page.text,
    pages: [{ page: page.page, text: page.text }],
    truncated: false,
  };
}

function promptInput(options: {
  input: ElectricalReviewRequestInput;
  drawing: ElectricalSelectedDrawing;
  page: ElectricalDrawingPage;
  kecResults: Awaited<ReturnType<ElectricalReviewPorts["searchKec"]>>;
  companyResults: CompanySearchResult[];
  findings: ReviewFinding[];
}): ReviewPromptInput {
  const evidence = pageEvidence(options.drawing, options.page);
  const itemReview: DesignItemReview = {
    name: drawingIdentity(options.drawing),
    evidence: [evidence],
    kecResults: options.kecResults,
    companyResults: options.companyResults,
    findings: options.findings,
  };

  return {
    projectPath: options.input.projectPath,
    files: [],
    pdfs: [pdfInput(options.page)],
    excels: [],
    kecResults: options.kecResults,
    companyResults: options.companyResults,
    itemReviews: [itemReview],
    findings: options.findings,
  };
}

function baseResult(
  selection: ElectricalReviewSelection,
  drawingQuery: string,
  candidates: ElectricalDrawingCandidate[],
  selectedDrawings: ElectricalSelectedDrawing[],
  warnings: string[],
): ElectricalReviewResult {
  return {
    selection,
    drawingQuery,
    candidates,
    selectedDrawings,
    warnings,
    kecCitations: [],
  };
}

export async function reviewElectricalRequest(
  input: ElectricalReviewRequestInput,
  ports: ElectricalReviewPorts,
): Promise<ElectricalReviewResult> {
  try {
    assertInput(input);
    const query = drawingRequestQuery(input.request);
    if (query.length === 0) {
      throw new Error("request must contain drawing search intent");
    }

    const search = await ports.searchDrawings(query);
    const warnings = [...search.warnings];
    if (search.totalCandidates === 0 || search.results.length === 0) {
      return baseResult("not-found", query, [], [], warnings);
    }

    const topScore = search.results.reduce(
      (maximum, candidate) => Math.max(maximum, candidate.score),
      Number.NEGATIVE_INFINITY,
    );
    const tied = search.results.filter(
      (candidate) => candidate.score === topScore,
    );
    if (tied.length > 1) {
      return baseResult("ambiguous", query, tied, [], warnings);
    }

    const candidate = tied[0]!;
    const drawing = selectedDrawing(candidate, search.sourcePath);
    if (drawing.page === null) {
      warnings.push(
        `drawing ${drawing.drawingNo} does not have a unique page mapping`,
      );
      return baseResult("selected", query, [candidate], [drawing], warnings);
    }

    let page: ElectricalDrawingPage;
    try {
      page = await ports.readDrawingPage(drawing.sourcePath, drawing.page);
    } catch (error) {
      warnings.push(errorMessage(error));
      return baseResult("selected", query, [candidate], [drawing], warnings);
    }

    warnings.push(...page.warnings);
    if (page.text.trim().length === 0) {
      warnings.push(
        `drawing ${drawing.drawingNo} page ${drawing.page} has no readable text`,
      );
      return baseResult("selected", query, [candidate], [drawing], warnings);
    }

    const context = [
      input.request,
      query,
      drawingIdentity(candidate),
      page.text,
    ].join("\n");
    let kecResults: Awaited<ReturnType<ElectricalReviewPorts["searchKec"]>> = [];
    let companyResults: CompanySearchResult[] = [];
    let knowledgeFindings: ReviewFinding[] = [];
    try {
      const knowledge = await createReviewKnowledgeQueryService(
        ports,
      ).searchProject({ context });
      kecResults = knowledge.kecResults;
      companyResults = knowledge.companyResults;
      knowledgeFindings = knowledge.warnings.map((warning) => ({
        severity: warning.severity,
        message: warning.message,
      }));
    } catch (error) {
      warnings.push(`KEC search: ${errorMessage(error)}`);
    }
    const findings: ReviewFinding[] = [
      ...warnings.map((message) => ({ severity: "warning" as const, message })),
      ...knowledgeFindings,
    ];
    const reviewInput = promptInput({
      input,
      drawing,
      page,
      kecResults,
      companyResults,
      findings,
    });
    const markdown = await ports.llm.generateReview(reviewInput);

    return {
      selection: "selected",
      drawingQuery: query,
      candidates: [candidate],
      selectedDrawings: [drawing],
      warnings: [
        ...warnings,
        ...knowledgeFindings.map((finding) => finding.message),
      ],
      kecCitations: kecResults.map(toKecCitation),
      markdown,
    };
  } finally {
    await ports.close?.();
  }
}

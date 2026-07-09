import type { ExcelReadResult, PdfReadResult, StructuredEvidence } from "./ports.js";

export type DesignItemName =
  | "케이블"
  | "차단기"
  | "분전반"
  | "조명"
  | "콘센트"
  | "접지"
  | "전압강하"
  | "부하";

export type DesignItemCandidate = {
  name: DesignItemName;
  evidence: StructuredEvidence[];
};

export type DesignItemCorpus = {
  pdfs: PdfReadResult[];
  excels: ExcelReadResult[];
};

const designItemSynonyms: Array<{
  name: DesignItemName;
  keywords: string[];
}> = [
  { name: "케이블", keywords: ["케이블", "전선", "cable"] },
  { name: "차단기", keywords: ["차단기", "mccb", "elb", "breaker"] },
  { name: "분전반", keywords: ["분전반", "panel", "distribution panel"] },
  { name: "조명", keywords: ["조명", "lighting", "light"] },
  { name: "콘센트", keywords: ["콘센트", "outlet", "receptacle"] },
  { name: "접지", keywords: ["접지", "ground", "grounding"] },
  { name: "전압강하", keywords: ["전압강하", "voltage drop"] },
  { name: "부하", keywords: ["부하", "load"] },
];

function normalize(text: string): string {
  return text.toLowerCase();
}

function createExcerpt(text: string, keyword: string): string {
  const normalizedText = normalize(text);
  const normalizedKeyword = normalize(keyword);
  const index = normalizedText.indexOf(normalizedKeyword);

  if (index < 0) {
    return text.slice(0, 160).trim();
  }

  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + keyword.length + 80);

  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function evidenceKey(evidence: StructuredEvidence): string {
  return [
    evidence.sourceType,
    evidence.sourcePath,
    evidence.page ?? "",
    evidence.sheetName ?? "",
    evidence.rowIndex ?? "",
    evidence.excerpt,
  ].join(":");
}

function splitEvidenceText(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?。])\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function collectPdfEvidence(pdf: PdfReadResult): StructuredEvidence[] {
  if (pdf.pages && pdf.pages.length > 0) {
    return pdf.pages.flatMap((page) =>
      splitEvidenceText(page.text).map((line) => ({
        sourceType: "pdf" as const,
        sourcePath: pdf.relativePath,
        page: page.page,
        excerpt: line,
      })),
    );
  }

  return splitEvidenceText(pdf.text).map((line) => ({
    sourceType: "pdf" as const,
    sourcePath: pdf.relativePath,
    excerpt: `${pdf.relativePath}: ${line}`,
  }));
}

function collectCorpusEvidence(corpus: DesignItemCorpus): StructuredEvidence[] {
  const pdfLines = corpus.pdfs.flatMap(collectPdfEvidence);
  const excelLines = corpus.excels.flatMap((excel) =>
    (excel.rows ?? []).flatMap((row, index) => {
      const excerpt = row
        .filter((value) => value !== null && value !== undefined)
        .join(" ")
        .trim();

      if (!excerpt) {
        return [];
      }

      return [
        {
          sourceType: "excel" as const,
          sourcePath: excel.relativePath,
          sheetName: excel.sheetName,
          rowIndex: index + 1,
          excerpt,
        },
      ];
    }),
  );

  return [...pdfLines, ...excelLines];
}

export function extractDesignItems(corpus: DesignItemCorpus): DesignItemCandidate[] {
  const evidenceItems = collectCorpusEvidence(corpus);
  const candidates = new Map<DesignItemName, DesignItemCandidate>();

  for (const evidence of evidenceItems) {
    const normalizedExcerpt = normalize(evidence.excerpt);

    for (const item of designItemSynonyms) {
      const keyword = item.keywords.find((candidate) => normalizedExcerpt.includes(candidate));

      if (!keyword) {
        continue;
      }

      const current = candidates.get(item.name) ?? { name: item.name, evidence: [] };
      const nextEvidence = {
        ...evidence,
        excerpt: createExcerpt(evidence.excerpt, keyword),
      };

      if (!current.evidence.some((candidate) => evidenceKey(candidate) === evidenceKey(nextEvidence))) {
        current.evidence.push(nextEvidence);
      }

      candidates.set(item.name, {
        ...current,
        evidence: current.evidence.slice(0, 3),
      });
    }
  }

  return Array.from(candidates.values());
}

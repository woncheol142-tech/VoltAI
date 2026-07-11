import type { KnowledgeDocument } from "@voltai/knowledge-core";

import { normalizeCompanyKnowledgeMetadata } from "./metadata.js";
import type {
  CompanyKnowledgeDocument,
  CompanyKnowledgeMetadata,
  CompanyPdfPage,
} from "./types.js";

function normalizeSourcePath(sourcePath: string): string {
  return sourcePath.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+/g, "/");
}

function normalizePages(pages: unknown): CompanyPdfPage[] {
  if (!Array.isArray(pages)) {
    throw new Error("PDF pages are required");
  }

  return pages.map((page) => {
    if (
      typeof page !== "object" ||
      page === null ||
      !("page" in page) ||
      !("text" in page) ||
      !Number.isInteger(page.page) ||
      page.page < 1 ||
      typeof page.text !== "string"
    ) {
      throw new Error("PDF pages must contain a positive page and text");
    }

    return { page: Number(page.page), text: page.text };
  });
}

export function createCompanyKnowledgeDocument(input: {
  sourcePath: string;
  pages: CompanyPdfPage[];
  standardId: string;
  title: string;
  section?: string | null;
  revision?: string | null;
  effectiveDate?: string | null;
  department?: string | null;
}): CompanyKnowledgeDocument {
  if (typeof input.sourcePath !== "string" || input.sourcePath.length === 0) {
    throw new Error("sourcePath is required");
  }

  const sourcePath = normalizeSourcePath(input.sourcePath);
  const metadata = normalizeCompanyKnowledgeMetadata({
    standardId: input.standardId,
    title: input.title,
    section: input.section,
    revision: input.revision,
    effectiveDate: input.effectiveDate,
    department: input.department,
  });
  const document: KnowledgeDocument<CompanyKnowledgeMetadata, { pages: CompanyPdfPage[] }> = {
    schemaVersion: 1,
    id: `company:${sourcePath}`,
    collection: "company",
    sourcePath,
    mediaType: "application/pdf",
    content: { pages: normalizePages(input.pages) },
    metadata,
  };

  return document;
}

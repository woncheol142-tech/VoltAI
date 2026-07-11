import type { PageLocator } from "@voltai/knowledge-core";

import type { CompanyKnowledgeChunk, CompanyKnowledgeDocument } from "./types.js";

export type CompanyChunkOptions = {
  chunkSize?: number;
  chunkOverlap?: number;
};

const defaultChunkSize = 1_000;
const defaultChunkOverlap = 100;

function resolveOptions(options: CompanyChunkOptions): { chunkSize: number; chunkOverlap: number } {
  const chunkSize = options.chunkSize ?? defaultChunkSize;
  const chunkOverlap = options.chunkOverlap ?? defaultChunkOverlap;

  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error("chunkSize must be a positive integer");
  }

  if (!Number.isInteger(chunkOverlap) || chunkOverlap < 0 || chunkOverlap >= chunkSize) {
    throw new Error("chunkOverlap must be non-negative and smaller than chunkSize");
  }

  return { chunkSize, chunkOverlap };
}

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

function fixedSizeChunks(text: string, chunkSize: number, chunkOverlap: number): string[] {
  const chunks: string[] = [];
  const step = chunkSize - chunkOverlap;

  for (let start = 0; start < text.length; start += step) {
    chunks.push(text.slice(start, start + chunkSize));
    if (start + chunkSize >= text.length) {
      break;
    }
  }

  return chunks;
}

function chunkPage(text: string, chunkSize: number, chunkOverlap: number): string[] {
  const paragraphs = normalizeText(text)
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  const chunks: string[] = [];
  let current = "";

  const flush = (): void => {
    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > chunkSize) {
      flush();
      chunks.push(...fixedSizeChunks(paragraph, chunkSize, chunkOverlap));
      continue;
    }

    const candidate = current.length === 0 ? paragraph : `${current}\n\n${paragraph}`;
    if (candidate.length <= chunkSize) {
      current = candidate;
      continue;
    }

    flush();
    current = paragraph;
  }

  flush();
  return chunks;
}

export function createCompanyChunks(
  document: CompanyKnowledgeDocument,
  options: CompanyChunkOptions = {},
): CompanyKnowledgeChunk[] {
  const { chunkSize, chunkOverlap } = resolveOptions(options);
  const chunks: CompanyKnowledgeChunk[] = [];

  for (const page of document.content.pages) {
    const pageChunks = chunkPage(page.text, chunkSize, chunkOverlap);

    pageChunks.forEach((text, chunkIndex) => {
      const locator: PageLocator = { kind: "page", page: page.page };
      chunks.push({
        chunkId: `${document.id}#page=${page.page}#chunk=${chunkIndex}`,
        documentId: document.id,
        sourcePath: document.sourcePath,
        chunkIndex,
        locator,
        metadata: { ...document.metadata },
        text,
      });
    });
  }

  return chunks;
}

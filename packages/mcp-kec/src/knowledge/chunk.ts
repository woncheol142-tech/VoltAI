import type { KecChunk } from "./vectorStore.js";

export const defaultChunkSize = 1200;
export const defaultChunkOverlap = 150;
export const defaultMinChunkLength = 15;

export type ChunkOptions = {
  chunkSize?: number;
  chunkOverlap?: number;
  minChunkLength?: number;
};

const clausePatterns = [
  /\bKEC\s+\d+(?:\.\d+)*/i,
  /제\s*\d+\s*조/,
  /\b\d{2,4}(?:\.\d+)+\b/,
];

export function extractClauseCandidate(text: string): string | null {
  for (const pattern of clausePatterns) {
    const match = text.match(pattern);

    if (match) {
      const value = match[0].replace(/\s+/g, " ").trim();

      if (/^kec/i.test(value)) {
        return value.replace(/^kec\s*/i, "KEC ");
      }

      return value.replace(/^제\s*/i, "제");
    }
  }

  return null;
}

function normalizeChunkOptions(options: ChunkOptions = {}): Required<ChunkOptions> {
  const chunkSize = options.chunkSize ?? defaultChunkSize;
  const chunkOverlap = options.chunkOverlap ?? defaultChunkOverlap;
  const minChunkLength = options.minChunkLength ?? defaultMinChunkLength;

  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error("chunkSize must be a positive integer");
  }

  if (!Number.isInteger(chunkOverlap) || chunkOverlap < 0) {
    throw new Error("chunkOverlap must be a non-negative integer");
  }

  if (!Number.isInteger(minChunkLength) || minChunkLength < 1) {
    throw new Error("minChunkLength must be a positive integer");
  }

  if (chunkOverlap >= chunkSize) {
    throw new Error("chunkOverlap must be smaller than chunkSize");
  }

  return { chunkSize, chunkOverlap, minChunkLength };
}

function splitParagraphs(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0);

  if (paragraphs.length > 1) {
    return paragraphs;
  }

  return normalized
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0);
}

function splitLongText(text: string, chunkSize: number): string[] {
  if (text.length <= chunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  const step = Math.max(1, Math.floor(chunkSize * 0.55));

  for (let start = 0; start < text.length; start += step) {
    chunks.push(text.slice(start, start + chunkSize).trimEnd());

    if (start + chunkSize >= text.length) {
      break;
    }
  }

  return chunks.filter((chunk) => chunk.trim().length > 0);
}

function buildChunkTexts(pageText: string, options: Required<ChunkOptions>): string[] {
  const paragraphs = splitParagraphs(pageText).flatMap((paragraph) =>
    paragraph.length >= options.minChunkLength
      ? splitLongText(paragraph, options.chunkSize)
      : [],
  );
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const next = current.length === 0 ? paragraph : `${current}\n\n${paragraph}`;

    if (next.length <= options.chunkSize) {
      current = next;
      continue;
    }

    if (current.length >= options.minChunkLength) {
      chunks.push(current);
    }

    const overlap = options.chunkOverlap > 0 ? current.slice(-options.chunkOverlap) : "";
    current = overlap.length > 0 ? `${overlap}${paragraph}` : paragraph;

    if (current.length > options.chunkSize) {
      const splitChunks = splitLongText(current, options.chunkSize);
      chunks.push(...splitChunks.slice(0, -1));
      current = splitChunks.at(-1) ?? "";
    }
  }

  if (current.length >= options.minChunkLength) {
    chunks.push(current);
  }

  return chunks.filter((chunk) => chunk.trim().length >= options.minChunkLength);
}

export function createPageChunks(
  sourcePath: string,
  pages: Array<{ page: number; text: string }>,
  options?: ChunkOptions,
): KecChunk[] {
  const normalizedOptions = normalizeChunkOptions(options);
  const chunks: KecChunk[] = [];

  for (const page of pages) {
    let carriedClause: string | null = null;
    const chunkTexts = buildChunkTexts(page.text, normalizedOptions);

    for (const chunkText of chunkTexts) {
      const extractedClause = extractClauseCandidate(chunkText);
      carriedClause = extractedClause ?? carriedClause;
      const chunkIndex = chunks.filter((chunk) => chunk.page === page.page).length;

      chunks.push({
        id: `${sourcePath}#page=${page.page}#chunk=${chunkIndex}`,
        sourcePath,
        page: page.page,
        chunkIndex,
        clause: carriedClause,
        text: chunkText.trimEnd(),
      });
    }
  }

  return chunks;
}

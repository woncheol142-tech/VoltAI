import type { KnowledgeCitation, PageLocator } from "@voltai/knowledge-core";

import type { KecCitation } from "./ports.js";

export type KecCitationMetadata = {
  clause: string | null;
};

function documentId(sourcePath: string): string {
  return `kec:${sourcePath}`;
}

export function kecCitationToKnowledgeCitation(
  citation: KecCitation,
): KnowledgeCitation<"kec", KecCitationMetadata, PageLocator> {
  return {
    citationId: citation.id,
    sourceType: "knowledge",
    domain: "kec",
    collection: "kec",
    documentId: documentId(citation.sourcePath),
    sourcePath: citation.sourcePath,
    locator: { kind: "page", page: citation.page },
    label: citation.label,
    excerpt: citation.excerpt,
    metadata: { clause: citation.label === "Unknown clause" ? null : citation.label },
  };
}

export function knowledgeCitationToKecCitation(
  citation: KnowledgeCitation<"kec", KecCitationMetadata, PageLocator>,
): KecCitation {
  return {
    id: citation.citationId,
    sourceType: "kec",
    sourcePath: citation.sourcePath,
    page: citation.locator.page,
    label: citation.label,
    excerpt: citation.excerpt,
  };
}

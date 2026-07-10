import { describe, expect, it } from "vitest";

import {
  kecCitationToKnowledgeCitation,
  knowledgeCitationToKecCitation,
} from "../src/kecCitationAdapter.js";
import { formatCitation, type KecCitation } from "../src/index.js";

describe("KEC citation compatibility adapter", () => {
  it("round-trips KecCitation without changing its report-facing shape", () => {
    const citation: KecCitation = {
      id: "kec:knowledge/kec.pdf:p3:KEC 232.5",
      sourceType: "kec",
      sourcePath: "knowledge/kec.pdf",
      page: 3,
      label: "KEC 232.5",
      excerpt: "Cable sizing requirement.",
    };
    const generic = kecCitationToKnowledgeCitation(citation);

    expect(generic).toEqual({
      citationId: citation.id,
      sourceType: "knowledge",
      domain: "kec",
      collection: "kec",
      documentId: "kec:knowledge/kec.pdf",
      sourcePath: citation.sourcePath,
      locator: { kind: "page", page: citation.page },
      label: citation.label,
      excerpt: citation.excerpt,
      metadata: { clause: citation.label },
    });
    expect(knowledgeCitationToKecCitation(generic)).toEqual(citation);
    expect(formatCitation(knowledgeCitationToKecCitation(generic))).toBe(
      "KEC 232.5 p.3: Cable sizing requirement.",
    );
  });

  it("preserves an unknown KEC clause as null metadata", () => {
    const citation: KecCitation = {
      id: "kec:knowledge/kec.pdf:p3:Unknown clause",
      sourceType: "kec",
      sourcePath: "knowledge/kec.pdf",
      page: 3,
      label: "Unknown clause",
      excerpt: "General requirement.",
    };

    expect(kecCitationToKnowledgeCitation(citation).metadata).toEqual({ clause: null });
    expect(knowledgeCitationToKecCitation(kecCitationToKnowledgeCitation(citation))).toEqual(
      citation,
    );
  });

  it("does not mutate citation inputs", () => {
    const citation: KecCitation = {
      id: "kec:knowledge/kec.pdf:p3:KEC 232.5",
      sourceType: "kec",
      sourcePath: "knowledge/kec.pdf",
      page: 3,
      label: "KEC 232.5",
      excerpt: "Cable sizing requirement.",
    };
    const snapshot = structuredClone(citation);
    const generic = kecCitationToKnowledgeCitation(citation);

    expect(citation).toEqual(snapshot);
    expect(generic).not.toBe(citation);
  });
});

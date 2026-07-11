import { describe, expect, it } from "vitest";

import { loadCompanyDomain } from "./helpers/companyFixtures.js";

const searchResult = {
  chunkId: "company:standards/electrical.pdf#page=4#chunk=2",
  sourcePath: "standards/electrical.pdf",
  page: 4,
  standardId: "CS-ELEC-001",
  title: "Electrical Design Standard",
  section: "4.2 Grounding",
  text: "Grounding conductors shall be bonded at the main panel.",
  similarity: 0.98,
};

describe("Company knowledge citation adapter", () => {
  it("converts a CompanySearchResult to a CompanyCitation", async () => {
    const { companySearchResultToCompanyCitation } = await loadCompanyDomain();

    expect(companySearchResultToCompanyCitation(searchResult)).toEqual({
      id: "company:company:standards/electrical.pdf#page=4#chunk=2",
      sourceType: "company",
      standardId: "CS-ELEC-001",
      title: "Electrical Design Standard",
      section: "4.2 Grounding",
      sourcePath: "standards/electrical.pdf",
      page: 4,
      excerpt: "Grounding conductors shall be bonded at the main panel.",
    });
  });

  it("uses the actual search chunk id as the stable citation identity", async () => {
    const { companySearchResultToCompanyCitation } = await loadCompanyDomain();
    const first = companySearchResultToCompanyCitation(searchResult);
    const second = companySearchResultToCompanyCitation({
      ...searchResult,
      text: "Changed excerpt text must not change identity.",
      similarity: 0.2,
    });

    expect(first.id).toBe(`company:${searchResult.chunkId}`);
    expect(second.id).toBe(first.id);
  });

  it("round-trips CompanyCitation through KnowledgeCitation without information loss", async () => {
    const {
      companyCitationToKnowledgeCitation,
      companySearchResultToCompanyCitation,
      knowledgeCitationToCompanyCitation,
    } = await loadCompanyDomain();
    const citation = companySearchResultToCompanyCitation(searchResult);
    const generic = companyCitationToKnowledgeCitation(citation);

    expect(generic).toMatchObject({
      citationId: citation.id,
      sourceType: "knowledge",
      domain: "company",
      collection: "company",
      documentId: "company:standards/electrical.pdf",
      sourcePath: citation.sourcePath,
      locator: { kind: "page", page: citation.page },
      excerpt: citation.excerpt,
      metadata: {
        standardId: citation.standardId,
        title: citation.title,
        section: citation.section,
      },
    });
    expect(knowledgeCitationToCompanyCitation(generic)).toEqual(citation);
  });

  it("does not mutate search results or citations", async () => {
    const {
      companyCitationToKnowledgeCitation,
      companySearchResultToCompanyCitation,
      knowledgeCitationToCompanyCitation,
    } = await loadCompanyDomain();
    const resultSnapshot = structuredClone(searchResult);
    const citation = companySearchResultToCompanyCitation(searchResult);
    const citationSnapshot = structuredClone(citation);
    const generic = companyCitationToKnowledgeCitation(citation);
    const genericSnapshot = structuredClone(generic);

    knowledgeCitationToCompanyCitation(generic);

    expect(searchResult).toEqual(resultSnapshot);
    expect(citation).toEqual(citationSnapshot);
    expect(generic).toEqual(genericSnapshot);
  });
});

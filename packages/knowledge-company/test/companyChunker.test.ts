import { describe, expect, it } from "vitest";

import { loadCompanyDomain } from "./helpers/companyFixtures.js";

async function createDocument(pages: Array<{ page: number; text: string }>) {
  const { createCompanyKnowledgeDocument } = await loadCompanyDomain();

  return createCompanyKnowledgeDocument({
    sourcePath: "standards/electrical.pdf",
    pages,
    standardId: "CS-1",
    title: "Electrical Standard",
  });
}

describe("Company PDF chunking", () => {
  it("preserves KnowledgeDocument identity and page provenance", async () => {
    const document = await createDocument([
      { page: 2, text: "Grounding standard paragraph." },
    ]);

    expect(document).toMatchObject({
      schemaVersion: 1,
      id: "company:standards/electrical.pdf",
      collection: "company",
      sourcePath: "standards/electrical.pdf",
      mediaType: "application/pdf",
      metadata: { standardId: "CS-1", section: null },
    });
  });

  it("splits normalized paragraphs deterministically", async () => {
    const { createCompanyChunks } = await loadCompanyDomain();
    const document = await createDocument([
      {
        page: 1,
        text: "First grounding paragraph.\r\n\r\nSecond grounding paragraph.",
      },
    ]);

    expect(
      createCompanyChunks(document, { chunkSize: 40, chunkOverlap: 5 }),
    ).toEqual(
      createCompanyChunks(document, { chunkSize: 40, chunkOverlap: 5 }),
    );
  });

  it("never combines text from different pages", async () => {
    const { createCompanyChunks } = await loadCompanyDomain();
    const document = await createDocument([
      { page: 1, text: "Page one grounding paragraph." },
      { page: 2, text: "Page two procurement paragraph." },
    ]);
    const chunks = createCompanyChunks(document, {
      chunkSize: 200,
      chunkOverlap: 10,
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0].locator).toEqual({ kind: "page", page: 1 });
    expect(chunks[1].locator).toEqual({ kind: "page", page: 2 });
    expect(chunks[0].text).not.toContain("Page two");
  });

  it("uses fixed-size fallback with deterministic overlap for a long paragraph", async () => {
    const { createCompanyChunks } = await loadCompanyDomain();
    const document = await createDocument([
      {
        page: 1,
        text: "Grounding conductors and bonding requirements must be documented carefully.",
      },
    ]);
    const chunks = createCompanyChunks(document, {
      chunkSize: 32,
      chunkOverlap: 8,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1].text.startsWith(chunks[0].text.slice(-8))).toBe(true);
    expect(
      chunks.every((chunk: { text: string }) => chunk.text.length <= 32),
    ).toBe(true);
  });

  it("uses document, page, and page-local index in stable chunk IDs", async () => {
    const { createCompanyChunks } = await loadCompanyDomain();
    const document = await createDocument([
      { page: 3, text: "Grounding paragraph." },
    ]);
    const [chunk] = createCompanyChunks(document);

    expect(chunk.chunkId).toBe(
      "company:standards/electrical.pdf#page=3#chunk=0",
    );
    expect(chunk.documentId).toBe(document.id);
    expect(chunk.chunkIndex).toBe(0);
  });

  it("does not interpret KEC clauses or create SectionLocator values", async () => {
    const { createCompanyChunks } = await loadCompanyDomain();
    const document = await createDocument([
      { page: 1, text: "KEC 232.5 is referenced internally." },
    ]);
    const [chunk] = createCompanyChunks(document);

    expect(chunk.locator).toEqual({ kind: "page", page: 1 });
    expect(chunk.metadata).toEqual(expect.objectContaining({ section: null }));
    expect(chunk.metadata).not.toHaveProperty("clause");
  });

  it("rejects overlap that is not smaller than chunkSize", async () => {
    const { createCompanyChunks } = await loadCompanyDomain();
    const document = await createDocument([
      { page: 1, text: "Grounding paragraph." },
    ]);

    expect(() =>
      createCompanyChunks(document, { chunkSize: 20, chunkOverlap: 20 }),
    ).toThrow();
  });

  it("does not mutate the source document", async () => {
    const { createCompanyChunks } = await loadCompanyDomain();
    const document = await createDocument([
      { page: 1, text: "Grounding paragraph." },
    ]);
    const snapshot = structuredClone(document);

    createCompanyChunks(document);

    expect(document).toEqual(snapshot);
  });
});

import { describe, expect, it } from "vitest";

import { loadCompanyDomain } from "./helpers/companyFixtures.js";

describe("Company knowledge metadata", () => {
  it("round-trips complete metadata through the provider-local codec", async () => {
    const { companyKnowledgeMetadataCodec } = await loadCompanyDomain();
    const metadata = {
      standardId: "CS-ELEC-001",
      title: "Electrical Design Standard",
      section: null,
      revision: "A",
      effectiveDate: "2026-07-01",
      department: "Engineering",
    };

    expect(
      companyKnowledgeMetadataCodec.decode(
        companyKnowledgeMetadataCodec.encode(metadata),
      ),
    ).toEqual(metadata);
  });

  it.each([
    ["standardId", { standardId: "", title: "Standard" }],
    ["title", { standardId: "CS-1", title: "" }],
  ])("rejects an empty required %s", async (_field, input) => {
    const { normalizeCompanyKnowledgeMetadata } = await loadCompanyDomain();

    expect(() => normalizeCompanyKnowledgeMetadata(input)).toThrow();
  });

  it("rejects a missing required field", async () => {
    const { normalizeCompanyKnowledgeMetadata } = await loadCompanyDomain();

    expect(() =>
      normalizeCompanyKnowledgeMetadata({ title: "Standard" }),
    ).toThrow();
  });

  it("rejects invalid effectiveDate formatting", async () => {
    const { normalizeCompanyKnowledgeMetadata } = await loadCompanyDomain();

    expect(() =>
      normalizeCompanyKnowledgeMetadata({
        standardId: "CS-1",
        title: "Standard",
        effectiveDate: "07/01/2026",
      }),
    ).toThrow();
  });

  it("normalizes every optional field to null without mutating input", async () => {
    const { normalizeCompanyKnowledgeMetadata } = await loadCompanyDomain();
    const input = { standardId: "CS-1", title: "Standard" };
    const snapshot = structuredClone(input);

    expect(normalizeCompanyKnowledgeMetadata(input)).toEqual({
      standardId: "CS-1",
      title: "Standard",
      section: null,
      revision: null,
      effectiveDate: null,
      department: null,
    });
    expect(input).toEqual(snapshot);
  });

  it("rejects persisted metadata with undefined or missing nullable fields", async () => {
    const { companyKnowledgeMetadataCodec } = await loadCompanyDomain();

    expect(() =>
      companyKnowledgeMetadataCodec.decode({
        standardId: "CS-1",
        title: "Standard",
      }),
    ).toThrow();
  });

  it("accepts only a positive PageLocator", async () => {
    const { companyPageLocatorCodec } = await loadCompanyDomain();

    expect(companyPageLocatorCodec.decode({ kind: "page", page: 1 })).toEqual({
      kind: "page",
      page: 1,
    });
    expect(() =>
      companyPageLocatorCodec.decode({ kind: "page", page: 0 }),
    ).toThrow();
    expect(() =>
      companyPageLocatorCodec.decode({ kind: "section", section: "A" }),
    ).toThrow();
  });
});

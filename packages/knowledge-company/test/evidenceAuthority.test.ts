import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { CompanyKnowledgeSearchResult } from "../src/index.js";
import { loadCompanyDomain } from "./helpers/companyFixtures.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDirectory, "..");
const workspaceRoot = join(packageRoot, "..", "..");
const typeContractFixture = join(
  testDirectory,
  "fixtures",
  "evidenceAuthorityContracts.ts",
);
const typescriptCli = join(
  workspaceRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

function companyEvidence(
  overrides: Partial<CompanyKnowledgeSearchResult> = {},
): CompanyKnowledgeSearchResult {
  return {
    chunkId: "company:standards/electrical.pdf#page=4#chunk=0",
    documentId: "company:standards/electrical.pdf",
    sourcePath: "standards/electrical.pdf",
    locator: { kind: "page", page: 4 },
    metadata: {
      standardId: "CS-ELEC-001",
      title: "Electrical Design Standard",
      section: "4.2 Grounding",
      revision: "A",
      effectiveDate: "2026-07-01",
      department: "Engineering",
    },
    text: "Grounding conductors shall be bonded at the main panel.",
    similarity: 0.99,
    ...overrides,
  };
}

describe("Company evidence authority", () => {
  it("compiles the company adapter signature and additive legacy fixtures", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [
          typescriptCli,
          "--noEmit",
          "--strict",
          "--target",
          "ES2022",
          "--module",
          "NodeNext",
          "--moduleResolution",
          "NodeNext",
          "--skipLibCheck",
          typeContractFixture,
        ],
        { cwd: workspaceRoot, stdio: "pipe" },
      ),
    ).not.toThrow();
  });

  it("classifies explicit Company knowledge without ranking or metadata heuristics", async () => {
    const { companyEvidenceAuthority } = await loadCompanyDomain();
    const highSimilarity = companyEvidence({
      sourcePath: "references/national-code-wording.pdf",
      similarity: 0.99,
      metadata: {
        standardId: "CS-ELEC-001",
        title: "Informal filename and title wording",
        section: null,
        revision: "Z",
        effectiveDate: "2030-12-31",
        department: "Legal",
      },
    });
    const lowSimilarity = companyEvidence({
      sourcePath: "misc/unlabelled-source.bin",
      similarity: 0.1,
      metadata: {
        standardId: "CS-ELEC-002",
        title: "Untitled document",
        section: "Appendix",
        revision: null,
        effectiveDate: null,
        department: null,
      },
    });

    const originalOrder = [highSimilarity, lowSimilarity].map(
      companyEvidenceAuthority,
    );
    const reversedOrder = [lowSimilarity, highSimilarity].map(
      companyEvidenceAuthority,
    );

    expect(originalOrder).toEqual([
      { authorityClass: "company-standard" },
      { authorityClass: "company-standard" },
    ]);
    expect(reversedOrder).toEqual([
      { authorityClass: "company-standard" },
      { authorityClass: "company-standard" },
    ]);
  });

  it("returns authority only and leaves existing provenance as the source of truth", async () => {
    const { companyEvidenceAuthority } = await loadCompanyDomain();
    const evidence = companyEvidence();
    const evidenceSnapshot = structuredClone(evidence);

    const authority = companyEvidenceAuthority(evidence);

    expect(authority).toEqual({ authorityClass: "company-standard" });
    expect(Object.keys(authority)).toEqual(["authorityClass"]);
    expect(evidence).toEqual(evidenceSnapshot);
    expect({
      documentId: evidence.documentId,
      sourcePath: evidence.sourcePath,
      locator: evidence.locator,
      metadata: evidence.metadata,
    }).toEqual({
      documentId: evidenceSnapshot.documentId,
      sourcePath: evidenceSnapshot.sourcePath,
      locator: evidenceSnapshot.locator,
      metadata: evidenceSnapshot.metadata,
    });
  });
});

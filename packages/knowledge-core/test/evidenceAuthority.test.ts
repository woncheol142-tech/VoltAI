import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  EvidenceAuthority,
  KnowledgeAuthorityClass,
} from "../src/index.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const typescriptCli = join(
  workspaceRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

const companyStandard: EvidenceAuthority = {
  authorityClass: "company-standard",
};
const unknown: EvidenceAuthority = { authorityClass: "unknown" };

// @ts-expect-error KEC collection identity is not an authority class.
const kec: KnowledgeAuthorityClass = "kec";
// @ts-expect-error Task67 does not establish a national-code class.
const nationalCode: KnowledgeAuthorityClass = "national-code";
// @ts-expect-error Task67 does not establish a statutory-code class.
const statutoryCode: KnowledgeAuthorityClass = "statutory-code";
// @ts-expect-error Unknown must not be replaced with a reference classification.
const reference: KnowledgeAuthorityClass = "reference";
// @ts-expect-error Authority classes are semantic strings, not numbers.
const numericAuthority: KnowledgeAuthorityClass = 100;

const rankedAuthority: EvidenceAuthority = {
  authorityClass: "company-standard",
  // @ts-expect-error EvidenceAuthority does not rank evidence.
  rank: 1,
};
const weightedAuthority: EvidenceAuthority = {
  authorityClass: "company-standard",
  // @ts-expect-error EvidenceAuthority does not weight evidence.
  weight: 1,
};
const prioritizedAuthority: EvidenceAuthority = {
  authorityClass: "company-standard",
  // @ts-expect-error EvidenceAuthority does not prioritize evidence.
  priority: 1,
};
const precedenceAuthority: EvidenceAuthority = {
  authorityClass: "company-standard",
  // @ts-expect-error EvidenceAuthority does not encode precedence.
  precedence: 1,
};
const winningAuthority: EvidenceAuthority = {
  authorityClass: "company-standard",
  // @ts-expect-error EvidenceAuthority does not choose a winner.
  winner: true,
};
const similarityAuthority: EvidenceAuthority = {
  authorityClass: "company-standard",
  // @ts-expect-error Similarity remains part of search evidence, not authority.
  similarity: 0.99,
};

void kec;
void nationalCode;
void statutoryCode;
void reference;
void numericAuthority;
void rankedAuthority;
void weightedAuthority;
void prioritizedAuthority;
void precedenceAuthority;
void winningAuthority;
void similarityAuthority;

describe("knowledge evidence authority public contract", () => {
  it("compiles the positive and negative authority type contracts", () => {
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
          testFile,
        ],
        { cwd: workspaceRoot, stdio: "pipe" },
      ),
    ).not.toThrow();

    expectTypeOf<KnowledgeAuthorityClass>().toEqualTypeOf<
      "company-standard" | "unknown"
    >();
    expectTypeOf<EvidenceAuthority>().toEqualTypeOf<{
      authorityClass: KnowledgeAuthorityClass;
    }>();

    expect(companyStandard).toEqual({ authorityClass: "company-standard" });
    expect(unknown).toEqual({ authorityClass: "unknown" });
  });
});

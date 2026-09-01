import { readFileSync } from "node:fs";

import * as decisionSqliteRoot from "../../packages/decision-sqlite/src/index.js";
import {
  createPolicyHarness,
  loadPolicyUnderTest,
} from "../../packages/kec-source-policy/test/fixtures/task95ArchitectureContract.js";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  requiredJson,
  requiredText,
  TASK96_RED_FAMILY_MAP,
  Task96RedContractError,
  task96Paths,
} from "./fixtures/task96ArchitectureContract.js";

type Family = keyof typeof TASK96_RED_FAMILY_MAP;

function family(label: Family, run: () => unknown | Promise<unknown>): void {
  const contract = TASK96_RED_FAMILY_MAP[label];
  it(`[${label}] ${contract.case}`, run);
}

function task90SourceWithVerifier(): string {
  const source = requiredText(
    task96Paths.task90Producer,
    "MISSING_TASK90_VERIFIER_GATE",
  );
  if (
    !/\bKecSourceBindingVerifier\b/u.test(source) ||
    !/\bverifyObservedBinding\b/u.test(source)
  ) {
    throw new Task96RedContractError(
      "MISSING_TASK90_VERIFIER_GATE",
      "Task90 has no mandatory local KecSourceBindingVerifier gate",
    );
  }
  return source;
}

function exportedFunction(
  source: string,
  name: string,
): ts.FunctionDeclaration | undefined {
  const file = ts.createSourceFile(
    task96Paths.task90Producer,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return file.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
}

describe("Task96 V4 Task90 verifier-gate RED contracts", () => {
  family("L", () => {
    const source = task90SourceWithVerifier();
    expect(source).toMatch(
      /verifyObservedBinding\s*\(\s*\{[\s\S]*?sourceRevision\s*:[\s\S]*?blobHash[\s\S]*?\}\s*\)/u,
    );
    expect(source).toMatch(/BINDING_ADMITTED/u);
    expect(source).toMatch(/BINDING_NOT_ADMITTED/u);
    expect(source).toMatch(/BINDING_WITHDRAWN/u);
    expect(source).toMatch(/BINDING_CONTRADICTION/u);
  });

  family("M", () => {
    const source = task90SourceWithVerifier();
    expect(source.match(/readKecPdfBytes\(absolutePdfPath\)/gu)).toHaveLength(
      1,
    );
    expect(source).not.toMatch(
      /verify(?:Observed)?Binding\s*\([^)]*(?:absolutePdfPath|sourceLocator|\.value)/isu,
    );
    expect(source).not.toMatch(
      /verifyObservedBinding[\s\S]*readKecPdfBytes\(absolutePdfPath\)/u,
    );
  });

  family("N", () => {
    const source = task90SourceWithVerifier();
    for (const name of [
      "extractKecRequirementSnapshot",
      "extractKecRequirementSnapshotWithCapture",
      "extractKecRequirements",
    ]) {
      const declaration = exportedFunction(source, name);
      expect(declaration, `${name} must exist`).toBeDefined();
      expect(declaration?.parameters).toHaveLength(2);
      expect(declaration?.parameters[1]?.questionToken).toBeUndefined();
      expect(declaration?.parameters[1]?.initializer).toBeUndefined();
    }
    expect(
      source.match(/extractKecRequirementPipeline\(/gu)?.length,
    ).toBeGreaterThanOrEqual(4);
  });

  family("O", () => {
    const schema = requiredText(
      task96Paths.task93Schema,
      "MISSING_TASK96_CONTRACT",
    );
    const store = requiredText(
      task96Paths.task93Store,
      "MISSING_TASK96_CONTRACT",
    );
    for (const coordinate of [
      "source_identity",
      "revision_key",
      "blob_algorithm",
      "blob_digest",
      "extraction_contract",
      "locator_space",
    ]) {
      expect(schema).toContain(coordinate);
    }
    expect(store).toContain("ORDER BY population_index ASC");
    expect(store).toContain("ORDER BY observation_index ASC");
    expect(store).toContain("snapshot-conflict");
    expect(schema).not.toMatch(/result_commitment|verification_receipt/iu);
  });

  family("Q", async () => {
    const harness = createPolicyHarness();
    const policy = await loadPolicyUnderTest(harness.dependencies);
    const case1 = await policy.evaluateCurrentKecCase({
      caseId: "CASE1",
      left: {
        assertingAuthorityReference: "observed:ministry",
        observedIdentifier: "2024-749",
      },
      right: {
        assertingAuthorityReference: "observed:kea",
        observedIdentifier: "2024-749",
      },
      registeredAssertionSchemes: [],
    });
    const case2 = await policy.evaluateCurrentKecCase({
      caseId: "CASE2",
      left: {
        assertingAuthorityReference: "observed:law-go-kr",
        observedIdentifier: "2025-227",
      },
      right: {
        assertingAuthorityReference: "observed:ministry",
        observedIdentifier: "consolidated",
      },
      registeredAssertionSchemes: [],
    });
    const case3 = await policy.evaluateCurrentKecCase({
      caseId: "CASE3",
      observation: { publisher: "observed:ministry" },
      assertionClaimRegistryLookup: "ABSENT",
      candidates: [],
      registeredAssertionSchemes: [],
    });

    expect(case1).toMatchObject({
      identity: "UNKNOWN_RELATIONSHIP",
      automation: "POLICY_LOOKUP_REQUIRED",
    });
    expect(case2).toMatchObject({
      identity: "UNKNOWN_RELATIONSHIP",
      automation: "POLICY_LOOKUP_REQUIRED",
    });
    expect(case3).toMatchObject({
      identityEstablishment: "NOT_ESTABLISHED",
      revision: "NOT_ESTABLISHED",
      automation: "POLICY_LOOKUP_REQUIRED",
    });
    expect(harness.issuedIdentities).toEqual([]);
    expect(harness.issuedRevisionKeys).toEqual([]);
  });

  family("R", () => {
    const source = readFileSync(task96Paths.task90Producer, "utf8");
    expect(source).not.toMatch(
      /KEC_CITABLE_SOURCE|KecCitableSource|citationWinner|publisherRank|preferredAuthority/iu,
    );
  });

  family("V", () => {
    const source = readFileSync(task96Paths.task90Producer, "utf8");
    expect(source).toMatch(/current\.x\s*-\s*previousRight\s*>=\s*72/u);
    expect(source).toMatch(/\.y\s*-\s*lines\[end\]!\.y\s*>=\s*8/u);
    expect(source).toMatch(/\.y\s*-\s*lines\[end\]!\.y\s*<=\s*36/u);
    expect(source).toMatch(/gap\s*<=\s*0\s*\|\|\s*gap\s*>\s*36/u);
  });

  family("Z", () => {
    const source = task90SourceWithVerifier();
    expect(source).toMatch(
      /const bytes = await readKecPdfBytes\(absolutePdfPath\)/u,
    );
    expect(source).toMatch(/sourceBlobHash\(bytes\)/u);
    expect(source).toMatch(/parseKecPdfTextItems\(bytes\)/u);
    expect(source).toMatch(
      /verifyObservedBinding[\s\S]{0,500}sourceRevision[\s\S]{0,500}blobHash/u,
    );
  });

  family("AA", () => {
    const manifest = requiredJson(
      task96Paths.decisionSqliteManifest,
      "MISSING_TASK96_CONTRACT",
    );
    const exportsMap = manifest.exports as Readonly<Record<string, unknown>>;
    expect("SqliteJudgementLedger" in decisionSqliteRoot).toBe(false);
    expect(exportsMap["./judgement-ledger"]).toEqual({
      types: "./src/judgementLedger.ts",
      "voltai-source": "./src/judgementLedger.ts",
      default: "./dist/judgementLedger.js",
    });
  });
});

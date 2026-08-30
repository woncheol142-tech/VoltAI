import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  SourceBlobHash,
  SourceIdentity,
  SourceRevision,
  SourceRevisionKey,
} from "../../source-core/src/index.js";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  createPolicyHarness,
  loadPolicyUnderTest,
  Task95RedContractError,
} from "./fixtures/task95ArchitectureContract.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(testDirectory, "..");
const sourceRoot = resolve(packageRoot, "src");
const policyEntrypoint = resolve(sourceRoot, "index.ts");
const packageManifest = resolve(packageRoot, "package.json");

function typescriptFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return typescriptFiles(path);
    }
    return extname(entry.name) === ".ts" ? [path] : [];
  });
}

function policyExportNames(): readonly string[] {
  if (!existsSync(policyEntrypoint)) {
    return [];
  }
  const program = ts.createProgram({
    rootNames: [policyEntrypoint],
    options: {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      types: [],
    },
  });
  const sourceFile = program.getSourceFile(policyEntrypoint);
  if (!sourceFile) {
    return [];
  }
  const symbol = program.getTypeChecker().getSymbolAtLocation(sourceFile);
  if (!symbol) {
    return [];
  }
  return program
    .getTypeChecker()
    .getExportsOfModule(symbol)
    .map((entry) => entry.name);
}

async function policyFixture() {
  const harness = createPolicyHarness();
  const policy = await loadPolicyUnderTest(harness.dependencies);
  return { harness, policy };
}

describe("Task95 V4 current KEC conservative case RED contracts", () => {
  it("RED-U CASE1 Ministry 2024-749 vs KEA 2024-749 remains unknown and requires policy lookup", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.evaluateCurrentKecCase({
      caseId: "CASE1",
      left: Object.freeze({
        assertingAuthorityReference: "observed:ministry",
        observedIdentifier: "2024-749",
      }),
      right: Object.freeze({
        assertingAuthorityReference: "observed:kea",
        observedIdentifier: "2024-749",
      }),
      registeredAssertionSchemes: Object.freeze([]),
    });

    expect(actual).toEqual({
      identity: "UNKNOWN_RELATIONSHIP",
      revision: "NOT_APPLICABLE",
      automation: "POLICY_LOOKUP_REQUIRED",
    });
  });

  it("RED-U CASE2 law.go.kr 2025-227 vs Ministry consolidated remains unknown and requires policy lookup", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.evaluateCurrentKecCase({
      caseId: "CASE2",
      left: Object.freeze({
        assertingAuthorityReference: "observed:law-go-kr",
        observedIdentifier: "2025-227",
      }),
      right: Object.freeze({
        assertingAuthorityReference: "observed:ministry",
        observedIdentifier: "consolidated",
      }),
      registeredAssertionSchemes: Object.freeze([]),
    });

    expect(actual).toEqual({
      identity: "UNKNOWN_RELATIONSHIP",
      revision: "NOT_APPLICABLE",
      automation: "POLICY_LOOKUP_REQUIRED",
    });
  });

  it("RED-U CASE3 Ministry observation plus registry absence does not establish identity", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.evaluateCurrentKecCase({
      caseId: "CASE3",
      observation: Object.freeze({ publisher: "observed:ministry" }),
      assertionClaimRegistryLookup: "ABSENT",
      candidates: Object.freeze([]),
      registeredAssertionSchemes: Object.freeze([]),
    });

    expect(actual).toEqual({
      identityEstablishment: "NOT_ESTABLISHED",
      pairwiseIdentityRelation: "NOT_APPLICABLE",
      revision: "NOT_ESTABLISHED",
      automation: "POLICY_LOOKUP_REQUIRED",
    });
  });

  it("RED-U CASE4 existing source-core coordinates permit one blob in multiple identity/revision associations", () => {
    type ObservationAssociation = Readonly<{
      blob: SourceBlobHash;
      revision: SourceRevision;
    }>;

    const blob: SourceBlobHash = Object.freeze({
      algorithm: "sha-256",
      digest: "fixed-case4-blob-digest",
    });
    const associations: readonly ObservationAssociation[] = Object.freeze([
      Object.freeze({
        blob,
        revision: Object.freeze({
          sourceIdentity: "opaque-source-identity-A" as SourceIdentity,
          revisionKey: "opaque-source-revision-A1" as SourceRevisionKey,
        }),
      }),
      Object.freeze({
        blob,
        revision: Object.freeze({
          sourceIdentity: "opaque-source-identity-B" as SourceIdentity,
          revisionKey: "opaque-source-revision-B7" as SourceRevisionKey,
        }),
      }),
    ]);

    expect(new Set(associations.map((entry) => entry.blob.digest))).toEqual(
      new Set(["fixed-case4-blob-digest"]),
    );
    expect(
      new Set(
        associations.map((entry) => entry.revision.sourceIdentity as string),
      ),
    ).toEqual(
      new Set(["opaque-source-identity-A", "opaque-source-identity-B"]),
    );
  });
});

describe("Task95 V4 policy ownership and no-leak RED contracts", () => {
  it("RED-U exports the policy-owned Task95 types", () => {
    const exports = policyExportNames();
    const requiredTypes = [
      "AssertionSchemeVersion",
      "BoundIdentityAssertion",
      "EvidenceSnapshot",
      "EvidenceSnapshotId",
      "IdentityEstablishmentOutcome",
      "IdentityRelation",
      "IssuanceRequestKey",
      "PolicyCaseId",
      "ReplayApplicabilityKeyFactory",
      "SourceIdentityPolicy",
      "SourceRevisionAssertionScheme",
    ];
    const missing = requiredTypes.filter((name) => !exports.includes(name));
    if (missing.length > 0) {
      throw new Task95RedContractError(
        "MISSING_POLICY_TYPE",
        missing.join(", "),
      );
    }
  });

  it("RED-U exports the registry, issuer, request, and judgement policy ports", () => {
    const exports = policyExportNames();
    const requiredPorts = [
      "AssertionClaimRegistry",
      "IssuanceRequestRegistry",
      "JudgementEscalationPort",
      "OpaqueSourceIdentityIssuer",
    ];
    const missing = requiredPorts.filter((name) => !exports.includes(name));
    if (missing.length > 0) {
      throw new Task95RedContractError(
        "MISSING_REGISTRY_CONTRACT",
        missing.join(", "),
      );
    }
  });

  it("RED-U production policy source contains no source-domain issuance classifier", () => {
    const forbiddenClassifier = ["Source", "Domain"].join("");
    const productionSource = typescriptFiles(sourceRoot)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(productionSource).not.toContain(forbiddenClassifier);
  });

  it("RED-U production policy source contains no Task96 binding runtime or citability classifier", () => {
    const forbidden = [
      ["Source", "Binding"].join(""),
      ["verify", "Binding"].join(""),
      ["binding", "Repository"].join(""),
      ["KEC", "_CITABLE", "_SOURCE"].join(""),
      ["Kec", "Citable", "Source"].join(""),
    ];
    const productionSource = typescriptFiles(sourceRoot)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    for (const marker of forbidden) {
      expect(productionSource).not.toContain(marker);
    }
  });

  it("RED-U policy package dependency direction remains inward and excludes mcp-kec and persistence", () => {
    if (!existsSync(packageManifest)) {
      return;
    }
    const manifest = JSON.parse(readFileSync(packageManifest, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const allowed = new Set([
      "@voltai/source-core",
      "@voltai/resolution-core",
      "@voltai/temporal-core",
    ]);

    expect(
      Object.keys(manifest.dependencies ?? {}).every((name) =>
        allowed.has(name),
      ),
    ).toBe(true);
  });
});

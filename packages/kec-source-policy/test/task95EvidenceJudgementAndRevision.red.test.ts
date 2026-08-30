import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as decisionSqliteRoot from "../../decision-sqlite/src/index.js";
import { SqliteJudgementLedger } from "../../decision-sqlite/src/judgementLedger.js";
import type {
  ImmutableJudgementRecord,
  JudgementRecordId,
  ReplayApplicabilityKey,
} from "../../decision-sqlite/src/judgementLedgerTypes.js";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  automaticOriginInput,
  createPolicyHarness,
  evidenceSnapshotE1,
  evidenceSnapshotE2,
  loadPolicyUnderTest,
  policyCaseId,
  Task95RedContractError,
} from "./fixtures/task95ArchitectureContract.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const policyEntrypoint = resolve(testDirectory, "../src/index.ts");
const decisionSqliteRootDirectory = resolve(
  testDirectory,
  "../../decision-sqlite",
);
const decisionSqliteManifest = resolve(
  decisionSqliteRootDirectory,
  "package.json",
);
const ledgerTypesPath = resolve(
  testDirectory,
  "../../decision-sqlite/src/judgementLedgerTypes.ts",
);

async function policyFixture() {
  const harness = createPolicyHarness();
  const policy = await loadPolicyUnderTest(harness.dependencies);
  return { harness, policy };
}

describe("Task95 V4 evidence snapshot RED contracts", () => {
  it("RED-Q EvidenceSnapshot membership is immutable", async () => {
    const { policy } = await policyFixture();
    const snapshot = await policy.createEvidenceSnapshot({
      snapshotId: "evidence-snapshot:immutable-1",
      members: Object.freeze(["evidence:A", "evidence:B"]),
      integrityDigest: "sha256:integrity-only-1",
    });

    expect(snapshot).toEqual({
      kind: "EVIDENCE_SNAPSHOT_CREATED",
      snapshotId: "evidence-snapshot:immutable-1",
      members: ["evidence:A", "evidence:B"],
      membership: "IMMUTABLE",
    });
  });

  it("RED-Q new or corrected evidence creates a new snapshot without mutating E1", async () => {
    const { policy } = await policyFixture();
    const e1 = await policy.createEvidenceSnapshot(evidenceSnapshotE1);
    const e2 = await policy.createEvidenceSnapshot({
      ...evidenceSnapshotE2,
      replacesEvidenceMember: "evidence:ministry-observation",
    });

    expect(e1).toEqual({
      kind: "EVIDENCE_SNAPSHOT_CREATED",
      snapshotId: "evidence-snapshot:E1",
      members: ["evidence:ministry-observation"],
      membership: "IMMUTABLE",
    });
    expect(e2).toEqual({
      kind: "EVIDENCE_SNAPSHOT_CREATED",
      snapshotId: "evidence-snapshot:E2",
      members: [
        "evidence:ministry-observation",
        "evidence:later-policy-reference",
      ],
      membership: "IMMUTABLE",
    });
  });

  it("RED-Q evidence digest remains integrity metadata and never a SourceIdentity", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.createEvidenceSnapshot({
      ...evidenceSnapshotE1,
      proposedSourceIdentity: evidenceSnapshotE1.integrityDigest,
    });

    expect(actual).toEqual({
      kind: "INVALID_EVIDENCE_IDENTITY_CONFLATION",
      reason: "EVIDENCE_DIGEST_IS_INTEGRITY_METADATA_ONLY",
    });
  });
});

describe("Task95 V4 replay applicability and f21396a ledger RED contracts", () => {
  it("RED-R same PolicyCase with E1 and E2 produces different replay applicability keys", async () => {
    const { policy } = await policyFixture();
    const common = {
      questionKey: "kec-source-policy:identity-establishment",
      subject: policyCaseId,
      policyEpoch: "kec-policy-epoch:95-v4",
    };
    const e1Key = await policy.createReplayApplicabilityKey({
      ...common,
      context: Object.freeze({ evidenceSnapshotId: "evidence-snapshot:E1" }),
    });
    const e2Key = await policy.createReplayApplicabilityKey({
      ...common,
      context: Object.freeze({ evidenceSnapshotId: "evidence-snapshot:E2" }),
    });

    expect(e2Key).not.toEqual(e1Key);
  });

  it("RED-R actual f21396a ledger does not replay an E1 judgement under the distinct E2 key", () => {
    const ledger = new SqliteJudgementLedger(":memory:");
    const e1Key =
      "task95:case-C:evidence-E1:epoch-v4" as ReplayApplicabilityKey;
    const e2Key =
      "task95:case-C:evidence-E2:epoch-v4" as ReplayApplicabilityKey;
    const recordId = "task95-judgement-fixed-E1" as JudgementRecordId;
    const record: ImmutableJudgementRecord = Object.freeze({
      recordId,
      address: Object.freeze({
        namespace: "task95-judgement-record/v1",
        recordKey: recordId,
      }),
      applicabilityKey: e1Key,
      judgement: Object.freeze({ outcome: "UNKNOWN" }),
      basis: Object.freeze(["evidence-snapshot:E1"]),
    });

    ledger.persistRecord(record);

    expect(ledger.replay(e1Key)).toEqual({
      kind: "SINGLE_ACTIVE_JUDGEMENT",
      record,
    });
    expect(ledger.replay(e2Key)).toEqual({ kind: "NO_ACTIVE_JUDGEMENT" });
  });

  it("RED-R decision-sqlite exposes the existing ledger through a dedicated public subpath without expanding root runtime exports", () => {
    expect("SqliteJudgementLedger" in decisionSqliteRoot).toBe(false);

    const manifest = JSON.parse(
      readFileSync(decisionSqliteManifest, "utf8"),
    ) as {
      exports?: Record<
        string,
        Readonly<{
          types?: string;
          "voltai-source"?: string;
          default?: string;
        }>
      >;
    };
    const publicLedgerExport = manifest.exports?.["./judgement-ledger"];
    if (publicLedgerExport === undefined) {
      throw new Task95RedContractError(
        "MISSING_JUDGEMENT_ADAPTER_EXPORT",
        "@voltai/decision-sqlite/judgement-ledger public subpath is absent",
      );
    }

    expect(publicLedgerExport).toEqual({
      types: "./src/judgementLedger.ts",
      "voltai-source": "./src/judgementLedger.ts",
      default: "./dist/judgementLedger.js",
    });

    const publicSourceEntrypoint = resolve(
      decisionSqliteRootDirectory,
      publicLedgerExport["voltai-source"] ?? "",
    );
    expect(existsSync(publicSourceEntrypoint)).toBe(true);

    const program = ts.createProgram({
      rootNames: [publicSourceEntrypoint],
      options: {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        types: [],
      },
    });
    const sourceFile = program.getSourceFile(publicSourceEntrypoint);
    const moduleSymbol =
      sourceFile === undefined
        ? undefined
        : program.getTypeChecker().getSymbolAtLocation(sourceFile);
    const publicSymbols =
      moduleSymbol === undefined
        ? []
        : program.getTypeChecker().getExportsOfModule(moduleSymbol);
    const ledgerClass = publicSymbols.find(
      (symbol) => symbol.name === "SqliteJudgementLedger",
    );

    expect(ledgerClass).toBeDefined();
    expect((ledgerClass?.flags ?? 0) & ts.SymbolFlags.Value).not.toBe(0);
  });
});

describe("Task95 V4 judgement escalation-only RED contracts", () => {
  it("RED-S declares a narrow JudgementEscalationPort instead of a policy-authority substitute", () => {
    if (!existsSync(policyEntrypoint)) {
      throw new Task95RedContractError(
        "MISSING_POLICY_PORT",
        "JudgementEscalationPort is absent with the Task95 policy module",
      );
    }
    const source = readFileSync(policyEntrypoint, "utf8");

    expect(source).toMatch(/\bJudgementEscalationPort\b/);
    expect(source).not.toMatch(
      /JudgementEscalationPort[\s\S]{0,1200}\b(discoverCandidates|parseRawMetadata|registerAssertionScheme|canonicalizeIdentifier|mintSourceIdentity|mintSourceRevisionKey)\b/,
    );
  });

  it("RED-S judgement resolves an already-defined policy question but returns no identity or revision", async () => {
    const { harness, policy } = await policyFixture();
    const actual = await policy.resolveJudgement({
      policyCaseId,
      evidenceSnapshotId: evidenceSnapshotE2.snapshotId,
      question: Object.freeze({
        questionKey: "kec-source-policy:identity-establishment",
        allowedOutcomes: Object.freeze([
          "REUSE_ESTABLISHED_IDENTITY",
          "ESTABLISH_NEW_IDENTITY",
          "NOT_ESTABLISHED",
        ]),
      }),
      judgementRecordId: "judgement-record:task95-fixed-1",
      outcome: "ESTABLISH_NEW_IDENTITY",
    });

    expect(actual).toEqual({
      kind: "POLICY_QUESTION_RESOLVED",
      outcome: "ESTABLISH_NEW_IDENTITY",
      policyCaseId,
      evidenceSnapshotId: "evidence-snapshot:E2",
    });
    expect(harness.issuedIdentities).toEqual([]);
  });

  it("RED-S actual judgement ledger port contains no discovery, parsing, scheme, canonicalization, or minting operation", () => {
    const source = readFileSync(ledgerTypesPath, "utf8");

    expect(source).not.toMatch(
      /\b(discoverCandidates|parseRawMetadata|registerAssertionScheme|canonicalizeIdentifier|bindAssertion|mintSourceIdentity|mintSourceRevisionKey)\b/,
    );
  });
});

describe("Task95 V4 identity and revision separation RED contracts", () => {
  it("RED-T identity establishment does not automatically issue an initial SourceRevisionKey", async () => {
    const { harness, policy } = await policyFixture();
    const actual = await policy.establishIdentityAtomically(
      automaticOriginInput(),
    );

    expect(actual).toMatchObject({
      kind: "AUTO_ESTABLISH_NEW_IDENTITY",
      sourceIdentity: "opaque-source-identity-1",
      canonicalAssertionClaim: {
        schemeId: "synthetic-kec-origin",
        schemeVersion: "S1",
        canonicalValue: "SYN-0001",
      },
    });
    expect(actual).not.toHaveProperty("sourceRevisionKey");
    expect(harness.issuedRevisionKeys).toEqual([]);
    expect(harness.registeredRevisions).toEqual([]);
  });

  it("RED-T no valid revision-state assertion means no SourceRevisionKey", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.establishRevision({
      sourceIdentity: "opaque-source-identity-existing",
      revisionAssertionScheme: undefined,
      revisionAssertion: undefined,
      identityAssertionCoordinates: Object.freeze({
        schemeId: "synthetic-kec-origin",
        schemeVersion: "S1",
        canonicalValue: "SYN-0001",
      }),
    });

    expect(actual).toEqual({
      kind: "REVISION_NOT_ESTABLISHED",
      reason: "INSUFFICIENT_REVISION_EVIDENCE",
      sourceRevisionKey: undefined,
    });
  });

  it("RED-T identity assertion coordinates cannot be reused as revision coordinates", async () => {
    const { policy } = await policyFixture();
    const identityCoordinates = Object.freeze({
      schemeId: "synthetic-kec-origin",
      schemeVersion: "S1",
      canonicalValue: "SYN-0001",
    });
    const actual = await policy.establishRevision({
      sourceIdentity: "opaque-source-identity-existing",
      revisionAssertionScheme: identityCoordinates,
      revisionAssertion: identityCoordinates,
    });

    expect(actual).toEqual({
      kind: "REVISION_NOT_ESTABLISHED",
      reason: "IDENTITY_REVISION_COORDINATE_REUSE",
      sourceRevisionKey: undefined,
    });
  });

  it("RED-T valid revision-state evidence uses the separate revision establishment operation", async () => {
    const { harness, policy } = await policyFixture();
    const actual = await policy.establishRevision({
      sourceIdentity: "opaque-source-identity-existing",
      revisionAssertionScheme: Object.freeze({
        kind: "SOURCE_REVISION_ASSERTION_SCHEME",
        schemeId: "synthetic-kec-revision",
        schemeVersion: "R1",
        assertingAuthorityReference: "synthetic-authority:alpha",
        revisionStateNamespace: "synthetic-kec-revision:v1",
      }),
      revisionAssertion: Object.freeze({
        schemeId: "synthetic-kec-revision",
        schemeVersion: "R1",
        revisionState: "SYN-REV-0001",
        bindingStatus: "BOUND",
      }),
    });

    expect(actual).toEqual({
      kind: "SOURCE_REVISION_ESTABLISHED",
      sourceIdentity: "opaque-source-identity-existing",
      sourceRevisionKey: "opaque-source-revision-1",
    });
    expect(harness.issuedRevisionKeys).toEqual(["opaque-source-revision-1"]);
    expect(harness.registeredRevisions).toEqual([
      {
        sourceIdentity: "opaque-source-identity-existing",
        revisionKey: "opaque-source-revision-1",
      },
    ]);
  });
});

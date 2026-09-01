import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  KEC_REQUIREMENT_EXTRACTION_CONTRACT_ID,
  KEC_REQUIREMENT_LOCATOR_SPACE,
  type KecRequirementExtractionBinding,
} from "../../packages/mcp-kec/src/knowledge/requirementExtraction.js";
import { KecRequirementSnapshotStore } from "../../packages/mcp-kec/src/requirementSnapshot/index.js";
import { deterministicKoreanPdfBytes } from "../../packages/mcp-kec/test/fixtures/requirementExtractionContracts.js";
import type {
  SourceBlobHash,
  SourceIdentity,
  SourceRevision,
  SourceRevisionKey,
} from "../../packages/source-core/src/index.js";
import {
  admitBinding,
  findBindingsByBlob,
  verifyBinding,
} from "../../packages/source-admission/src/index.js";
import { SqliteBindingRepository } from "../../packages/source-admission-sqlite/src/index.js";
import { describe, expect, it } from "vitest";

import {
  productionText,
  TASK97_RED_FAMILY_MAP,
  task97Paths,
  type Task97Family,
} from "./fixtures/task97ArchitectureContract.js";
import {
  call,
  candidate,
  established,
  outcomeKind,
  withTask97System,
  type Task97System,
  type UnknownRecord,
} from "./fixtures/task97RuntimeHarness.js";

function withPipelineSystem<Result>(
  run: (system: Task97System) => Result | Promise<Result>,
): Promise<Result> {
  return withTask97System(run, "pipeline");
}

function task97Contract(
  label: Task97Family,
  id: string,
  run: () => unknown | Promise<unknown>,
): void {
  const contract = TASK97_RED_FAMILY_MAP[label].tests.find(
    (entry) => entry.id === id,
  );
  if (contract === undefined)
    throw new Error(`Unmapped Task97 contract ${label}:${id}`);
  it(`[${label}:${id}] ${contract.contract}`, run);
}

async function registerSyntheticPolicy(system: Task97System): Promise<void> {
  await call(system.registrar, "registerAssertionSchemeVersion", {
    epoch: "task97:test:epoch-1",
    scheme: {
      schemeId: "synthetic.identity",
      version: "1",
      assertingAuthorityReference: "test:reviewed-policy-authority",
      identifierNamespace: "synthetic:test-only",
      canonicalization: {
        ruleId: "synthetic:exact:v1",
        deterministic: true,
        equivalencePreservingTransformations: [],
      },
      bindingRule: "test-only explicit bound assertion",
      equalitySemantics: "exact canonical value",
      differenceSemantics: "distinct canonical values",
      aliasesPossible: "NO",
      renumberingPossible: "NO",
      identifierReusePossible: "NO",
      originIssuanceCapability: "YES",
      semanticApproval: {
        policyDecisionId: "reviewed:test-only",
        evidenceReference: "synthetic:no-real-source",
        approvingAuthorityRole: "PolicyRegistrar",
        policyEpoch: "task97:test:epoch-1",
      },
    },
  });
  await call(system.registrar, "replaceActiveOriginScheme", {
    epoch: "task97:test:epoch-1",
    schemeId: "synthetic.identity",
    schemeVersion: "1",
  });
  await call(system.registrar, "registerRevisionAssertionScheme", {
    epoch: "task97:test:epoch-1",
    scheme: {
      kind: "SOURCE_REVISION_ASSERTION_SCHEME",
      schemeId: "synthetic.revision",
      schemeVersion: "1",
      assertingAuthorityReference: "test:reviewed-policy-authority",
      revisionStateNamespace: "synthetic:test-only",
      canonicalization: {
        ruleId: "synthetic:revision:exact:v1",
        transformations: [],
      },
    },
  });
}

function hash(bytes: Uint8Array): SourceBlobHash {
  return Object.freeze({
    algorithm: "sha-256",
    digest: createHash("sha256").update(bytes).digest("hex"),
  });
}

async function registerOriginScheme(
  system: Task97System,
  epoch: string,
  schemeId: string,
): Promise<void> {
  await call(system.registrar, "registerAssertionSchemeVersion", {
    epoch,
    scheme: {
      schemeId,
      version: "1",
      assertingAuthorityReference: "test:reviewed-policy-authority",
      identifierNamespace: `synthetic:test-only:${schemeId}`,
      canonicalization: {
        ruleId: `synthetic:identity:exact:${schemeId}:v1`,
        deterministic: true,
        equivalencePreservingTransformations: [],
      },
      bindingRule: "test-only explicit bound assertion",
      equalitySemantics: "exact canonical value",
      differenceSemantics: "distinct canonical values",
      aliasesPossible: "NO",
      renumberingPossible: "NO",
      identifierReusePossible: "NO",
      originIssuanceCapability: "YES",
      semanticApproval: {
        policyDecisionId: `reviewed:test-only:${schemeId}:v1`,
        evidenceReference: "synthetic:no-real-source",
        approvingAuthorityRole: "PolicyRegistrar",
        policyEpoch: epoch,
      },
    },
  });
}

describe("Task97 V1 Task96 handoff and package-boundary RED contracts", () => {
  task97Contract("S", "revision-is-not-admission", async () => {
    await withTask97System(async (system) => {
      await registerSyntheticPolicy(system);
      const result = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate(),
      );
      const handoff = established(result);
      const repository = new SqliteBindingRepository(
        join(system.root, "independent-admission.sqlite"),
      );
      try {
        const binding = {
          sourceRevision: handoff.sourceRevision as SourceRevision,
          blobHash: (candidate().acquisition as UnknownRecord)
            .observedBlobHash as SourceBlobHash,
        };
        expect((await verifyBinding(repository, binding)).kind).toBe(
          "BINDING_NOT_ADMITTED",
        );
        expect(system.spies.admitBinding).not.toHaveBeenCalled();
      } finally {
        repository.close();
      }
    });
  });

  task97Contract("T", "handoff-has-no-blob", () => {
    const source = productionText(
      task97Paths.resolutionRoot,
      "MISSING_KEC_SOURCE_RESOLUTION",
    );
    const match = source.match(
      /(?:type|interface)\s+EstablishedSourceRevision[\s\S]*?\n\s*\};?/,
    );
    expect(match?.[0]).toBeDefined();
    expect(match?.[0]).toContain("sourceRevision");
    expect(match?.[0]).toContain("identityBasis");
    expect(match?.[0]).toContain("revisionBasis");
    expect(match?.[0]).toContain("resolutionRecordRef");
    expect(match?.[0]).not.toMatch(/blobHash|locator/i);
  });

  task97Contract("U", "unresolved-stops-pipeline", async () => {
    await withPipelineSystem(async (system) => {
      const result = await call(system.pipeline, "runPreBoundKecExtraction", {
        candidate: candidate(),
        bytes: new TextEncoder().encode("synthetic bytes only"),
        projectRoot: system.root,
      });
      expect(outcomeKind(result)).toBe("RESOLUTION_INCOMPLETE");
      expect(outcomeKind((result as UnknownRecord).resolution)).toBe(
        "POLICY_LOOKUP_REQUIRED",
      );
      expect(system.spies.admitBinding).not.toHaveBeenCalled();
      expect(system.spies.runVerifiedKecExtraction).not.toHaveBeenCalled();
    });
  });

  task97Contract("V", "authority-and-citability-firewall", () => {
    const resolution = productionText(
      task97Paths.resolutionRoot,
      "MISSING_KEC_SOURCE_RESOLUTION",
    );
    const allNewSource = [
      resolution,
      productionText(
        task97Paths.policySqliteRoot,
        "MISSING_KEC_SOURCE_POLICY_SQLITE",
      ),
      productionText(
        task97Paths.policyJudgementRoot,
        "MISSING_KEC_SOURCE_POLICY_JUDGEMENT",
      ),
      productionText(task97Paths.pipelineRoot, "MISSING_KEC_SOURCE_PIPELINE"),
    ].join("\n");
    const candidateDeclaration = resolution.match(
      /(?:type|interface)\s+ObservedSourceCandidate[\s\S]*?\n\s*\};?/,
    )?.[0];
    expect(candidateDeclaration).toBeDefined();
    for (const forbidden of [
      "sourceIdentity",
      "revisionKey",
      "sourceRevision",
      "identityRelation",
      "identityRelationship",
      "official",
      "trusted",
      "authoritative",
      "citable",
      "citationAuthority",
      "publisherPrecedence",
      "activeOriginScheme",
      "registeredSchemes",
      "revisionAssertionScheme",
      "issuer",
      "authority",
      "basis",
      "judgement",
    ]) {
      expect(candidateDeclaration).not.toMatch(
        new RegExp(`\\b${forbidden}\\b`, "i"),
      );
    }
    const allocated = [
      ...allNewSource.matchAll(
        /kec\.source\.(?:identity|revision|acquisition)\.[a-z]+\/v1/g,
      ),
    ].map((entry) => entry[0]);
    expect([...new Set(allocated)].sort()).toEqual([
      "kec.source.acquisition.content/v1",
      "kec.source.identity.origin/v1",
      "kec.source.identity.relation/v1",
      "kec.source.revision.origin/v1",
      "kec.source.revision.relation/v1",
    ]);
    expect(allNewSource).not.toMatch(
      /KEC_CITABLE_SOURCE|citationWinner|publisherRanking|officialSourcePreference/,
    );
    expect(allNewSource).not.toMatch(
      /from\s+["'](?:openai|@voltai\/agent-review)|LLM.*(?:register|mint|admit|recordJudgement)/i,
    );

    const outputKinds = [
      ...resolution.matchAll(/kind:\s*["']([A-Z_]+)["']/g),
    ].map((entry) => entry[1]);
    for (const kind of [
      "IDENTITY_AND_REVISION_ESTABLISHED",
      "IDENTITY_ESTABLISHED_REVISION_NOT_ESTABLISHED",
      "POLICY_LOOKUP_REQUIRED",
      "HUMAN_JUDGEMENT_REQUIRED",
      "UNRESOLVED",
      "POLICY_CONTRADICTION",
      "IDENTITY_ISSUANCE_CONFLICT",
      "REVISION_ESTABLISHMENT_CONFLICT",
    ]) {
      expect(outputKinds).toContain(kind);
    }
  });

  task97Contract("W", "zero-kec-auto-origin", async () => {
    await withTask97System(async (system) => {
      expect(
        await call(
          system.registrar,
          "activeOriginDesignations",
          "task97:test:epoch-1",
        ),
      ).toEqual([]);
      expect(
        await call(
          system.registrar,
          "registeredKecAssertionSchemes",
          "task97:test:epoch-1",
        ),
      ).toEqual([]);
      const result = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate({
          observedMetadata: [{ key: "publisher", value: "KEA" }],
        }),
      );
      expect(outcomeKind(result)).toBe("POLICY_LOOKUP_REQUIRED");
      expect((result as UnknownRecord).reason).toBe("NO_ACTIVE_ORIGIN_SCHEME");
      expect(system.spies.issueIdentity).not.toHaveBeenCalled();
      expect(await call(system.pipeline, "probeReadiness")).toEqual({
        task97CodeComplete: true,
        bootstrapConfigured: false,
        realProbeReady: false,
        bootstrapClassification: "PROBE_SETUP",
      });
    });
  });

  task97Contract("X", "case4-many-to-many", async () => {
    const directory = mkdtempSync(join(tmpdir(), "task97-case4-"));
    const repository = new SqliteBindingRepository(
      join(directory, "admission.sqlite"),
    );
    try {
      const sharedBlob = hash(new TextEncoder().encode("same synthetic bytes"));
      const bindings = [
        {
          sourceRevision: {
            sourceIdentity: "task97:identity:A" as SourceIdentity,
            revisionKey: "task97:revision:A1" as SourceRevisionKey,
          },
          blobHash: sharedBlob,
        },
        {
          sourceRevision: {
            sourceIdentity: "task97:identity:B" as SourceIdentity,
            revisionKey: "task97:revision:B7" as SourceRevisionKey,
          },
          blobHash: sharedBlob,
        },
        {
          sourceRevision: {
            sourceIdentity: "task97:identity:A" as SourceIdentity,
            revisionKey: "task97:revision:A1" as SourceRevisionKey,
          },
          blobHash: hash(
            new TextEncoder().encode("alternate acquisition bytes"),
          ),
        },
      ];
      for (const binding of bindings) {
        await admitBinding(
          repository,
          binding,
          "task97:test:acquisition-authority",
          "task97:test:attestation",
        );
      }
      expect(await findBindingsByBlob(repository, sharedBlob)).toEqual(
        bindings.slice(0, 2),
      );
      expect((await verifyBinding(repository, bindings[2])).kind).toBe(
        "BINDING_ADMITTED",
      );
    } finally {
      repository.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  task97Contract("AB", "trusted-principal-surface", () => {
    const source = productionText(
      task97Paths.resolutionRoot,
      "MISSING_KEC_SOURCE_RESOLUTION",
    );
    const publicEntry = readFileSync(task97Paths.resolutionEntrypoint, "utf8");
    expect(publicEntry).toMatch(/resolveSourceIdentityAndRevision/);
    expect(publicEntry).not.toMatch(
      /export\s+(?:class|function|const)\s+(?:PolicyRegistrar|SourcePolicyAuthority|JudgementActor|OpaqueSourceIdentityIssuer)/,
    );
    const signature = source.match(
      /resolveSourceIdentityAndRevision\s*\(([^)]*)\)/,
    )?.[1];
    expect(signature).toBeDefined();
    expect(signature?.split(",")).toHaveLength(1);
    expect(signature).not.toMatch(
      /issuer|authority|scheme|judgement|registrar|active/i,
    );
  });

  task97Contract("AC", "package-direction", () => {
    for (const [root, code] of [
      [task97Paths.policySqliteRoot, "MISSING_KEC_SOURCE_POLICY_SQLITE"],
      [task97Paths.policyJudgementRoot, "MISSING_KEC_SOURCE_POLICY_JUDGEMENT"],
      [task97Paths.resolutionRoot, "MISSING_KEC_SOURCE_RESOLUTION"],
      [task97Paths.pipelineRoot, "MISSING_KEC_SOURCE_PIPELINE"],
    ] as const) {
      productionText(root, code);
    }
    const manifests = [
      [
        task97Paths.policySqliteRoot,
        ["@voltai/kec-source-policy", "@voltai/source-core"],
      ],
      [
        task97Paths.policyJudgementRoot,
        [
          "@voltai/kec-source-policy",
          "@voltai/decision-sqlite",
          "@voltai/source-core",
        ],
      ],
      [
        task97Paths.resolutionRoot,
        [
          "@voltai/kec-source-policy",
          "@voltai/kec-source-policy-sqlite",
          "@voltai/kec-source-policy-judgement",
          "@voltai/source-core",
        ],
      ],
      [
        task97Paths.pipelineRoot,
        [
          "@voltai/kec-source-resolution",
          "@voltai/source-admission",
          "@voltai/source-admission-sqlite",
          "@voltai/kec-source-runtime",
          "@voltai/source-core",
        ],
      ],
    ] as const;
    for (const [root, required] of manifests) {
      const manifest = JSON.parse(
        readFileSync(join(root, "package.json"), "utf8"),
      ) as UnknownRecord;
      const dependencies = (manifest.dependencies ?? {}) as UnknownRecord;
      for (const dependency of required)
        expect(dependencies).toHaveProperty(dependency);
    }
    const resolutionDependencies = JSON.parse(
      readFileSync(join(task97Paths.resolutionRoot, "package.json"), "utf8"),
    ) as { dependencies?: UnknownRecord };
    for (const forbidden of [
      "@voltai/source-admission",
      "@voltai/source-admission-sqlite",
      "@voltai/kec-source-runtime",
      "@voltai/mcp-kec",
      "@voltai/extraction-core",
    ]) {
      expect(resolutionDependencies.dependencies ?? {}).not.toHaveProperty(
        forbidden,
      );
    }
    const resolutionSource = productionText(
      task97Paths.resolutionRoot,
      "MISSING_KEC_SOURCE_RESOLUTION",
    );
    expect(resolutionSource).not.toMatch(
      /admitBinding|runVerifiedKecExtraction/,
    );
    expect(
      productionText(task97Paths.pipelineRoot, "MISSING_KEC_SOURCE_PIPELINE"),
    ).toMatch(/admitBinding/);
  });

  task97Contract("AD", "acquisition-attestation", async () => {
    await withPipelineSystem(async (system) => {
      await registerSyntheticPolicy(system);
      const bytes = deterministicKoreanPdfBytes();
      const sourceLocator = { scheme: "file", value: "kec/task97.pdf" };
      mkdirSync(join(system.root, "kec"), { recursive: true });
      writeFileSync(join(system.root, sourceLocator.value), bytes);
      const input = candidate({
        acquisition: {
          locator: sourceLocator,
          observedBlobHash: hash(bytes),
          observedByteLength: bytes.byteLength,
        },
      });
      const noAttestation = await call(
        system.pipeline,
        "runPreBoundKecExtraction",
        {
          candidate: input,
          bytes,
          projectRoot: system.root,
        },
      );
      expect(outcomeKind(noAttestation)).toBe("BINDING_NOT_ESTABLISHED");
      expect((noAttestation as UnknownRecord).reason).toBe(
        "ACQUISITION_ATTESTATION_ABSENT",
      );
      expect(system.spies.admitBinding).not.toHaveBeenCalled();

      await call(system.judgementActor, "recordJudgement", {
        questionKey: "kec.source.acquisition.content/v1",
        decision: "APPROVE",
        actor: "task97:test:JudgementActor",
      });
      const genericApproval = await call(
        system.pipeline,
        "runPreBoundKecExtraction",
        {
          candidate: input,
          bytes,
          projectRoot: system.root,
        },
      );
      expect(outcomeKind(genericApproval)).toBe("BINDING_NOT_ESTABLISHED");
      expect(system.spies.admitBinding).not.toHaveBeenCalled();

      await call(system.pipeline, "attestAcquisitionContent", {
        sourceRevision: established(
          await call(
            system.resolution,
            "resolveSourceIdentityAndRevision",
            input,
          ),
        ).sourceRevision,
        blobHash: hash(bytes),
        locator: (input.acquisition as UnknownRecord).locator,
        decision: "ADMIT_BINDING",
        actor: "task97:test:JudgementActor",
      });
      const completed = await call(
        system.pipeline,
        "runPreBoundKecExtraction",
        {
          candidate: input,
          bytes,
          projectRoot: system.root,
        },
      );
      expect(completed).toMatchObject({
        kind: "VERIFIED_EXECUTION_COMPLETE",
        realSourceObserved: true,
      });
      expect(
        await call(system.pipeline, "countVerifiedExecutionReceipts"),
      ).toBe(1);
      expect(system.spies.admitBinding).toHaveBeenCalledWith(
        expect.objectContaining({ blobHash: hash(bytes) }),
        "kec:acquisition-admission-authority:v1",
        expect.stringMatching(/kec:admission-basis:v1/),
      );
      const changedBytes = new TextEncoder().encode(
        "synthetic acquisition bytes CHANGED",
      );
      const executionCallCount =
        system.spies.runVerifiedKecExtraction.mock.calls.length;
      const changed = await call(system.pipeline, "runPreBoundKecExtraction", {
        candidate: input,
        bytes: changedBytes,
        projectRoot: system.root,
      });
      expect(outcomeKind(changed)).not.toBe("VERIFIED_EXECUTION_COMPLETE");
      expect(system.spies.runVerifiedKecExtraction).toHaveBeenCalledTimes(
        executionCallCount,
      );
    });
  });

  task97Contract("AG", "no-late-blessing", async () => {
    await withPipelineSystem(async (system) => {
      await registerSyntheticPolicy(system);
      const resolved = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate(),
      );
      const sourceRevision = established(resolved)
        .sourceRevision as SourceRevision;
      const acquisition = candidate().acquisition as UnknownRecord;
      const binding: KecRequirementExtractionBinding = {
        sourceRevision,
        blobHash: acquisition.observedBlobHash as SourceBlobHash,
        extractionContract: KEC_REQUIREMENT_EXTRACTION_CONTRACT_ID,
        locatorSpace: KEC_REQUIREMENT_LOCATOR_SPACE,
      };
      const task93 = new KecRequirementSnapshotStore(
        join(system.root, "task93.sqlite"),
      );
      try {
        task93.storeSnapshot({ binding, requirements: [] });
        expect(task93.loadSnapshot(binding)).toEqual({
          binding,
          requirements: [],
        });
      } finally {
        task93.close();
      }
      const status = await call(system.pipeline, "loadVerifiedExecution", {
        sourceIdentity: sourceRevision.sourceIdentity,
        revisionKey: sourceRevision.revisionKey,
        blobAlgorithm: binding.blobHash.algorithm,
        blobDigest: binding.blobHash.digest,
        extractionContract: binding.extractionContract,
        locatorSpace: binding.locatorSpace,
      });
      expect(outcomeKind(status)).toBe("VERIFIED_EXECUTION_INCOMPLETE");
      expect((status as UnknownRecord).realSourceObserved).not.toBe(true);
      expect(
        await call(system.pipeline, "countVerifiedExecutionReceipts"),
      ).toBe(0);
    });
  });

  task97Contract("AH", "atomic-sealed-epoch", async () => {
    await withTask97System(async (system) => {
      await registerSyntheticPolicy(system);
      await call(system.registrar, "sealPolicyEpoch", "task97:test:epoch-1");
      const editFailure = await call(
        system.registrar,
        "registerCrosswalkEdge",
        {
          epoch: "task97:test:epoch-1",
          left: "claim:A",
          right: "claim:B",
          relation: "SAME_IDENTITY",
        },
      ).catch((failure: unknown) => failure);
      expect(editFailure).toMatchObject({ name: "PolicyEpochSealedFailure" });

      const unregistered = await call(
        system.registrar,
        "replaceActiveOriginScheme",
        {
          epoch: "task97:test:epoch-unregistered",
          schemeId: "scheme:unknown",
          schemeVersion: "1",
        },
      ).catch((failure: unknown) => failure);
      expect(unregistered).toMatchObject({
        name: "PolicyRegistrationFailure",
        reason: "ACTIVE_SCHEME_VERSION_NOT_REGISTERED",
      });

      await registerOriginScheme(system, "task97:test:epoch-2", "scheme:A");
      await registerOriginScheme(system, "task97:test:epoch-2", "scheme:B");
      await call(system.registrar, "replaceActiveOriginScheme", {
        epoch: "task97:test:epoch-2",
        schemeId: "scheme:A",
        schemeVersion: "1",
      });
      await call(system.registrar, "registerCrossVersionCorrespondence", {
        epoch: "task97:test:epoch-2",
        predecessor: { schemeId: "scheme:A", version: "1" },
        successor: { schemeId: "scheme:B", version: "1" },
        correspondence: {
          kind: "DISJOINT_IDENTIFIER_SPACE",
          predecessorSchemeVersion: { schemeId: "scheme:A", version: "1" },
          successorSchemeVersion: { schemeId: "scheme:B", version: "1" },
        },
      });

      const attempts = await Promise.allSettled([
        call(system.registrar, "replaceActiveOriginScheme", {
          epoch: "task97:test:epoch-2",
          schemeId: "scheme:B",
          schemeVersion: "1",
        }),
        call(system.registrar, "replaceActiveOriginScheme", {
          epoch: "task97:test:epoch-2",
          schemeId: "scheme:A",
          schemeVersion: "1",
        }),
      ]);
      expect(
        attempts.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        await call(
          system.registrar,
          "countActiveOriginDesignations",
          "task97:test:epoch-2",
        ),
      ).toBeLessThanOrEqual(1);
      const snapshots = (await call(
        system.registrar,
        "capturedConcurrentReadSnapshots",
        "task97:test:epoch-2",
      )) as readonly UnknownRecord[];
      expect(
        snapshots.every(
          (snapshot) => Number(snapshot.activeOriginDesignationCount) <= 1,
        ),
      ).toBe(true);
    });
  });
});

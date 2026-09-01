import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vi, type Mock } from "vitest";

import {
  invoke,
  loadFutureModule,
  requiredFunction,
  task97Paths,
} from "./task97ArchitectureContract.js";

export type UnknownRecord = Readonly<Record<string, unknown>>;
export type FutureSurface = "policy" | "judgement" | "resolution" | "pipeline";

export type Task97Spies = Readonly<{
  issueIdentity: Mock;
  issueRevision: Mock;
  associateIdentity: Mock;
  associateRevision: Mock;
  admitBinding: Mock;
  runVerifiedKecExtraction: Mock;
}>;

export type Task97System = Readonly<{
  root: string;
  resolution: UnknownRecord;
  registrar: UnknownRecord;
  judgementActor: UnknownRecord;
  pipeline: UnknownRecord;
  spies: Task97Spies;
  close(): Promise<void>;
}>;

export function candidate(changes: UnknownRecord = {}): UnknownRecord {
  return Object.freeze({
    observationId: "observation:task97:1",
    acquisition: Object.freeze({
      locator: Object.freeze({
        scheme: "https",
        value: "example.invalid/kec.pdf",
      }),
      observedBlobHash: Object.freeze({
        algorithm: "sha-256",
        digest: "a".repeat(64),
      }),
      observedByteLength: 4096,
    }),
    rawIdentityAssertions: Object.freeze([
      Object.freeze({
        schemeId: "synthetic.identity",
        schemeVersion: "1",
        rawValue: "claim-A",
        bindingStatus: "BOUND",
        bindingEvidenceRef: "evidence:bound-identity",
      }),
    ]),
    rawRevisionAssertions: Object.freeze([
      Object.freeze({
        schemeId: "synthetic.revision",
        schemeVersion: "1",
        rawRevisionState: "revision-1",
        bindingStatus: "BOUND",
        bindingEvidenceRef: "evidence:bound-revision",
      }),
    ]),
    observedMetadata: Object.freeze([]),
    ...changes,
  });
}

export function outcomeKind(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as UnknownRecord;
  return typeof record.kind === "string" ? record.kind : undefined;
}

export function reasonOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as UnknownRecord;
  return typeof record.reason === "string" ? record.reason : undefined;
}

async function requireFutureSurface(surface: FutureSurface): Promise<void> {
  const coordinates = {
    policy: [
      task97Paths.policySqliteEntrypoint,
      "MISSING_KEC_SOURCE_POLICY_SQLITE",
    ],
    judgement: [
      task97Paths.policyJudgementEntrypoint,
      "MISSING_KEC_SOURCE_POLICY_JUDGEMENT",
    ],
    resolution: [
      task97Paths.resolutionEntrypoint,
      "MISSING_KEC_SOURCE_RESOLUTION",
    ],
    pipeline: [task97Paths.pipelineEntrypoint, "MISSING_KEC_SOURCE_PIPELINE"],
  } as const;
  const [path, code] = coordinates[surface];
  await loadFutureModule(path, code);
}

export async function openTask97System(
  firstSurface: FutureSurface = "policy",
): Promise<Task97System> {
  await requireFutureSurface(firstSurface);
  const [policySqlite, policyJudgement, resolutionModule, pipelineModule] =
    await Promise.all([
      loadFutureModule(
        task97Paths.policySqliteEntrypoint,
        "MISSING_KEC_SOURCE_POLICY_SQLITE",
      ),
      loadFutureModule(
        task97Paths.policyJudgementEntrypoint,
        "MISSING_KEC_SOURCE_POLICY_JUDGEMENT",
      ),
      loadFutureModule(
        task97Paths.resolutionEntrypoint,
        "MISSING_KEC_SOURCE_RESOLUTION",
      ),
      loadFutureModule(
        task97Paths.pipelineEntrypoint,
        "MISSING_KEC_SOURCE_PIPELINE",
      ),
    ]);

  const root = mkdtempSync(join(tmpdir(), "task97-red-"));
  const spies: Task97Spies = Object.freeze({
    issueIdentity: vi.fn(),
    issueRevision: vi.fn(),
    associateIdentity: vi.fn(),
    associateRevision: vi.fn(),
    admitBinding: vi.fn(),
    runVerifiedKecExtraction: vi.fn(),
  });

  try {
    const registrar = (await invoke(
      requiredFunction(policySqlite, "openPolicyRegistrar"),
      Object.freeze({ databasePath: join(root, "policy.sqlite") }),
    )) as UnknownRecord;
    const judgementActor = (await invoke(
      requiredFunction(policyJudgement, "openJudgementActor"),
      Object.freeze({ databasePath: join(root, "judgement.sqlite") }),
    )) as UnknownRecord;
    const resolution = (await invoke(
      requiredFunction(resolutionModule, "openKecSourceResolution"),
      Object.freeze({
        policyDatabasePath: join(root, "policy.sqlite"),
        judgementDatabasePath: join(root, "judgement.sqlite"),
        policyEpoch: "task97:test:epoch-1",
        testInstrumentation: spies,
      }),
    )) as UnknownRecord;
    const pipeline = (await invoke(
      requiredFunction(pipelineModule, "openKecSourcePipeline"),
      Object.freeze({
        resolution,
        sourceAdmissionDatabasePath: join(root, "admission.sqlite"),
        receiptDatabasePath: join(root, "receipt.sqlite"),
        task93DatabasePath: join(root, "task93.sqlite"),
        testInstrumentation: spies,
      }),
    )) as UnknownRecord;

    return Object.freeze({
      root,
      resolution,
      registrar,
      judgementActor,
      pipeline,
      spies,
      close: async () => {
        for (const value of [pipeline, resolution, judgementActor, registrar]) {
          if (typeof value.close === "function") await value.close.call(value);
        }
        rmSync(root, { recursive: true, force: true });
      },
    });
  } catch (failure) {
    rmSync(root, { recursive: true, force: true });
    throw failure;
  }
}

export async function withTask97System<Result>(
  run: (system: Task97System) => Result | Promise<Result>,
  firstSurface: FutureSurface = "policy",
): Promise<Result> {
  const system = await openTask97System(firstSurface);
  try {
    return await run(system);
  } finally {
    await system.close();
  }
}

export async function call(
  owner: UnknownRecord,
  name: string,
  ...args: readonly unknown[]
): Promise<unknown> {
  return invoke(requiredFunction(owner, name), ...args);
}

export function established(value: unknown): UnknownRecord {
  if (typeof value !== "object" || value === null) {
    throw new Error("Task97 result is not an object");
  }
  const result = value as UnknownRecord;
  if (result.kind !== "IDENTITY_AND_REVISION_ESTABLISHED") {
    throw new Error(
      `Expected established Task97 result, observed ${String(result.kind)}`,
    );
  }
  if (typeof result.established !== "object" || result.established === null) {
    throw new Error(
      "Established Task97 result lacks its authoritative handoff",
    );
  }
  return result.established as UnknownRecord;
}

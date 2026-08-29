import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import type {
  ImmutableJudgementRecord,
  JudgementLedger,
  JudgementSupersession,
  LifecycleFailurePoint,
  ReplayApplicabilityKey,
} from "./fixtures/judgementLedgerRedContract.js";
import {
  createJudgementLedgerHarness,
  createJudgementRecord,
  judgementRecordId,
  replayApplicabilityKey,
  supersession,
} from "./fixtures/judgementLedgerRedContract.js";

type RedDefinition = {
  readonly whyThisTestExists: string;
  readonly architecturalInvariant: string;
  readonly expectedFailureBeforeGreen: string;
  readonly failureMeaning: string;
};

const RED_CASES = {
  A: {
    whyThisTestExists:
      "Prevent V2.1 identity conflation from making later judgements unwritable.",
    architecturalInvariant:
      "JudgementRecordId is independent of ReplayApplicabilityKey; one applicability key indexes zero or many immutable records.",
    expectedFailureBeforeGreen:
      "No production ledger adapter can persist and retrieve both R1 and R2 yet.",
    failureMeaning:
      "The multiple-record-per-applicability persistence contract is not implemented.",
  },
  B: {
    whyThisTestExists:
      "Specify the successful append-only lifecycle transition before transaction mechanics are chosen.",
    architecturalInvariant:
      "J1 and J2 remain historical, J1 -> J2 is recorded, and only J2 is active.",
    expectedFailureBeforeGreen:
      "No atomic supersession operation or lifecycle observation exists yet.",
    failureMeaning:
      "The happy-path lifecycle transaction is missing, not that history may be mutated.",
  },
  C: {
    whyThisTestExists:
      "Keep an attempted transition from creating an edge to a record whose write failed.",
    architecturalInvariant:
      "Record-write failure leaves the prior lifecycle exactly observable and creates no dangling J1 -> J2 edge.",
    expectedFailureBeforeGreen:
      "The deterministic record-write failure seam and rollback behavior are absent.",
    failureMeaning: "Pre-record failure atomicity is not implemented.",
  },
  D: {
    whyThisTestExists:
      "Close the architecture blocker where record insertion succeeds but edge insertion fails.",
    architecturalInvariant:
      "Edge-write failure cannot expose J2 as a valid completed supersession or alter J1's prior lifecycle.",
    expectedFailureBeforeGreen:
      "The record and edge components are not enclosed by one externally atomic transition.",
    failureMeaning:
      "A partial lifecycle could be externally interpreted as completed.",
  },
  E: {
    whyThisTestExists:
      "Model crash-equivalent interruption deterministically for either component ordering.",
    architecturalInvariant:
      "After recovery, a transition is entirely present or entirely absent; never a valid partial history.",
    expectedFailureBeforeGreen:
      "No recovery-safe commit boundary exists at either between-write seam.",
    failureMeaning: "ALL_OR_NOTHING_OBSERVABILITY is not enforced.",
  },
  F: {
    whyThisTestExists:
      "Make ambiguous failure retry safe without introducing policy semantics or a new policy identity.",
    architecturalInvariant:
      "Retrying the same R2 and J1 -> J2 transition creates one record, one edge, and one active head.",
    expectedFailureBeforeGreen: "No atomic idempotent retry behavior exists.",
    failureMeaning:
      "Persistence retry mechanics can duplicate or conflict with lifecycle state.",
  },
  G: {
    whyThisTestExists:
      "Forbid storage order, lexical order, or insertion time from adjudicating policy conflicts.",
    architecturalInvariant:
      "Two unrelated active heads under K return CONFLICTING_ACTIVE_JUDGEMENTS carrying both records.",
    expectedFailureBeforeGreen:
      "Active-set derivation and fail-closed conflict reporting do not exist.",
    failureMeaning:
      "The ledger cannot yet distinguish conflict from a selected winner.",
  },
  H: {
    whyThisTestExists:
      "Prevent a cycle from collapsing to the same empty active set as a legitimate withdrawal lifecycle.",
    architecturalInvariant:
      "Cycle detection precedes active selection and returns LIFECYCLE_CORRUPT.",
    expectedFailureBeforeGreen: "Lifecycle graph validation does not exist.",
    failureMeaning:
      "Corrupt persistence could be misreported as policy absence.",
  },
  I: {
    whyThisTestExists:
      "Keep infrastructure unavailability distinct from policy absence and human-decision escalation.",
    architecturalInvariant:
      "A persistence read failure returns PERSISTENCE_UNAVAILABLE only.",
    expectedFailureBeforeGreen:
      "Read-failure normalization into the ledger result algebra does not exist.",
    failureMeaning:
      "An outage could be mistaken for NO_ACTIVE_JUDGEMENT or POLICY_DECISION_REQUIRED.",
  },
  J: {
    whyThisTestExists:
      "Make policy-subject membership inference structurally unreachable from replay.",
    architecturalInvariant:
      "Replay accepts only an already-resolved ReplayApplicabilityKey, never raw artifact attributes.",
    expectedFailureBeforeGreen:
      "The type-only contract is established in RED; no runtime policy implementation is expected.",
    failureMeaning:
      "Any unused @ts-expect-error means replay has widened into policy-rule application.",
  },
} as const satisfies Record<string, RedDefinition>;

const K = replayApplicabilityKey("applicability:K");
const J1 = createJudgementRecord(judgementRecordId("R1"), K, "A");
const J2 = createJudgementRecord(judgementRecordId("R2"), K, "B");
const J3 = createJudgementRecord(judgementRecordId("R3"), K, "C");

function expectDefinition(definition: RedDefinition): void {
  expect(Object.values(definition).every((value) => value.length > 0)).toBe(
    true,
  );
}

function recordIds(records: readonly ImmutableJudgementRecord[]): Set<string> {
  return new Set(records.map((record) => record.recordId));
}

function edgeKeys(edges: readonly JudgementSupersession[]): Set<string> {
  return new Set(
    edges.map(
      (edge) =>
        `${edge.superseded.namespace}\0${edge.superseded.recordKey}\0${edge.superseding.namespace}\0${edge.superseding.recordKey}`,
    ),
  );
}

function expectPriorJ1Lifecycle(
  ledger: JudgementLedger,
  applicabilityKey: ReplayApplicabilityKey,
): void {
  expect(recordIds(ledger.recordsFor(applicabilityKey))).toEqual(
    new Set([J1.recordId]),
  );
  expect(ledger.supersessionsFor(applicabilityKey)).toEqual([]);
  expect(ledger.replay(applicabilityKey)).toEqual({
    kind: "SINGLE_ACTIVE_JUDGEMENT",
    record: J1,
  });
}

function expectCommittedJ2Lifecycle(ledger: JudgementLedger): void {
  expect(recordIds(ledger.recordsFor(K))).toEqual(
    new Set([J1.recordId, J2.recordId]),
  );
  expect(edgeKeys(ledger.supersessionsFor(K))).toEqual(
    edgeKeys([supersession(J1, J2)]),
  );
  expect(ledger.replay(K)).toEqual({
    kind: "SINGLE_ACTIVE_JUDGEMENT",
    record: J2,
  });
}

describe("V2.2 judgement-ledger lifecycle atomicity RED", () => {
  it("RED-A keeps distinct R1 and R2 under the same applicability K", () => {
    expectDefinition(RED_CASES.A);
    expect(J1.recordId).not.toBe(J2.recordId);
    expect(J1.applicabilityKey).toBe(J2.applicabilityKey);
    const { ledger } = createJudgementLedgerHarness();

    ledger.persistRecord(J1);
    ledger.persistRecord(J2);

    expect(recordIds(ledger.recordsFor(K))).toEqual(
      new Set([J1.recordId, J2.recordId]),
    );
  });

  it("RED-B atomically commits immutable J1, immutable J2, and J1 -> J2", () => {
    expectDefinition(RED_CASES.B);
    const { ledger, driver } = createJudgementLedgerHarness();
    driver.seedRecord(J1);

    ledger.persistSupersedingJudgement({ record: J2, supersedes: J1.address });

    expectCommittedJ2Lifecycle(ledger);
    expect(J1.judgement.outcome).toEqual({ outcome: "A" });
  });

  it("RED-C rolls back before/new-record persistence failure", () => {
    expectDefinition(RED_CASES.C);
    const { ledger, driver } = createJudgementLedgerHarness();
    driver.seedRecord(J1);
    driver.failNextAt("RECORD_WRITE");

    expect(() =>
      ledger.persistSupersedingJudgement({
        record: J2,
        supersedes: J1.address,
      }),
    ).toThrow();
    driver.recover();

    expectPriorJ1Lifecycle(ledger, K);
  });

  it("RED-D does not expose record-success plus edge-failure as completed", () => {
    expectDefinition(RED_CASES.D);
    const { ledger, driver } = createJudgementLedgerHarness();
    driver.seedRecord(J1);
    driver.failNextAt("EDGE_WRITE");

    expect(() =>
      ledger.persistSupersedingJudgement({
        record: J2,
        supersedes: J1.address,
      }),
    ).toThrow();
    driver.recover();

    expectPriorJ1Lifecycle(ledger, K);
  });

  it.each<LifecycleFailurePoint>([
    "AFTER_RECORD_COMPONENT",
    "AFTER_EDGE_COMPONENT",
  ])(
    "RED-E recovers all-or-nothing after crash-equivalent %s failure",
    (failurePoint) => {
      expectDefinition(RED_CASES.E);
      const { ledger, driver } = createJudgementLedgerHarness();
      driver.seedRecord(J1);
      driver.failNextAt(failurePoint);

      expect(() =>
        ledger.persistSupersedingJudgement({
          record: J2,
          supersedes: J1.address,
        }),
      ).toThrow();
      driver.recover();

      expectPriorJ1Lifecycle(ledger, K);
    },
  );

  it("RED-F retries one ambiguous transition without duplicate state", () => {
    expectDefinition(RED_CASES.F);
    const { ledger, driver } = createJudgementLedgerHarness();
    driver.seedRecord(J1);
    driver.failNextAt("AFTER_EDGE_COMPONENT");

    expect(() =>
      ledger.persistSupersedingJudgement({
        record: J2,
        supersedes: J1.address,
      }),
    ).toThrow();
    driver.recover();
    ledger.persistSupersedingJudgement({ record: J2, supersedes: J1.address });

    expectCommittedJ2Lifecycle(ledger);
    expect(ledger.recordsFor(K)).toHaveLength(2);
    expect(ledger.supersessionsFor(K)).toHaveLength(1);
  });

  it("RED-G fails closed when J2 and J3 are unrelated active heads", () => {
    expectDefinition(RED_CASES.G);
    const { ledger, driver } = createJudgementLedgerHarness();
    driver.seedRecord(J2);
    driver.seedRecord(J3);

    const result = ledger.replay(K);

    expect(result.kind).toBe("CONFLICTING_ACTIVE_JUDGEMENTS");
    if (result.kind === "CONFLICTING_ACTIVE_JUDGEMENTS") {
      expect(recordIds(result.records)).toEqual(
        new Set([J2.recordId, J3.recordId]),
      );
    }
  });

  it("RED-H detects J1 -> J2 -> J1 before active-head selection", () => {
    expectDefinition(RED_CASES.H);
    const { ledger, driver } = createJudgementLedgerHarness();
    driver.seedRecord(J1);
    driver.seedRecord(J2);
    driver.seedSupersession(supersession(J1, J2));
    driver.seedSupersession(supersession(J2, J1));

    expect(ledger.replay(K)).toEqual({ kind: "LIFECYCLE_CORRUPT" });
  });

  it("RED-I maps persistence read failure only to PERSISTENCE_UNAVAILABLE", () => {
    expectDefinition(RED_CASES.I);
    const { ledger, driver } = createJudgementLedgerHarness();
    driver.seedRecord(J1);
    driver.failNextAt("READ");

    const result = ledger.replay(K);

    expect(result).toEqual({ kind: "PERSISTENCE_UNAVAILABLE" });
    expect(result.kind).not.toBe("NO_ACTIVE_JUDGEMENT");
    expect(JSON.stringify(result)).not.toContain("POLICY_DECISION_REQUIRED");
  });

  it("RED-J makes raw artifact attributes uncallable at replay", () => {
    expectDefinition(RED_CASES.J);
    const testDirectory = dirname(fileURLToPath(import.meta.url));
    const fixture = resolve(
      testDirectory,
      "fixtures/judgementLedgerReplayBoundary.ts",
    );
    const program = ts.createProgram({
      rootNames: [fixture],
      options: {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        types: [],
      },
    });
    const diagnostics = [
      ...program.getSyntacticDiagnostics(),
      ...program.getSemanticDiagnostics(),
    ];
    const formatted = diagnostics.map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n",
      );
      if (!diagnostic.file || diagnostic.start === undefined) {
        return `TS${diagnostic.code}: ${message}`;
      }
      const position = diagnostic.file.getLineAndCharacterOfPosition(
        diagnostic.start,
      );
      return `${relative(resolve(testDirectory, "../../.."), diagnostic.file.fileName)}:${position.line + 1}:${position.character + 1} TS${diagnostic.code}: ${message}`;
    });

    expect(formatted, formatted.join("\n")).toEqual([]);
  });
});

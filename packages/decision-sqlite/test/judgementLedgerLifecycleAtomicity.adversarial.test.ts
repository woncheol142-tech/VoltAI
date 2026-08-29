import { describe, expect, it } from "vitest";
import {
  createJudgementLedgerHarness,
  createJudgementRecord,
  judgementRecordId,
  replayApplicabilityKey,
} from "./fixtures/judgementLedgerRedContract.js";

const K = replayApplicabilityKey("applicability:K");
const J1 = createJudgementRecord(judgementRecordId("R1"), K, "A");
const J2 = createJudgementRecord(judgementRecordId("R2"), K, "B");

describe("Atomicity DB verification", () => {
  it("leaves zero partial rows on AFTER_EDGE_COMPONENT failure", () => {
    const harness = createJudgementLedgerHarness();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ledger = harness.ledger as any;
    const db = ledger.database;
    harness.driver.seedRecord(J1);

    expect(
      db.prepare("SELECT COUNT(*) as c FROM judgement_records").get().c,
    ).toBe(1);

    harness.driver.failNextAt("AFTER_EDGE_COMPONENT");
    expect(() =>
      ledger.persistSupersedingJudgement({
        record: J2,
        supersedes: J1.address,
      }),
    ).toThrow();
    harness.driver.recover();

    expect(
      db.prepare("SELECT COUNT(*) as c FROM judgement_records").get().c,
    ).toBe(1);
    expect(
      db.prepare("SELECT COUNT(*) as c FROM judgement_supersessions").get().c,
    ).toBe(0);
  });
});

describe("Rollback failure", () => {
  it("does not mask original error and does not poison connection", () => {
    const harness = createJudgementLedgerHarness();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ledger = harness.ledger as any;
    const db = ledger.database;
    harness.driver.seedRecord(J1);

    const originalExec = db.exec;
    db.exec = function (sql: string) {
      if (sql === "ROLLBACK") throw new Error("simulated rollback failure");
      return originalExec.call(this, sql);
    };

    harness.driver.failNextAt("AFTER_EDGE_COMPONENT");

    let caughtError: unknown;
    try {
      ledger.persistSupersedingJudgement({
        record: J2,
        supersedes: J1.address,
      });
    } catch (e: unknown) {
      caughtError = e;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((caughtError as any)?.message).toContain(
      "injected judgement-ledger failure",
    );

    const res = ledger.replay(K);
    expect(res.kind).not.toBe("PERSISTENCE_UNAVAILABLE");
  });
});

describe("Fail-stop behavior", () => {
  it("marks ledger unusable if transaction cannot be rolled back", () => {
    const harness = createJudgementLedgerHarness();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ledger = harness.ledger as any;
    const db = ledger.database;
    harness.driver.seedRecord(J1);

    const originalExec = db.exec;
    db.exec = function (sql: string) {
      if (sql.startsWith("ROLLBACK"))
        throw new Error("simulated absolute rollback failure");
      return originalExec.call(this, sql);
    };

    harness.driver.failNextAt("AFTER_EDGE_COMPONENT");

    let caughtError: unknown;
    try {
      ledger.persistSupersedingJudgement({
        record: J2,
        supersedes: J1.address,
      });
    } catch (e: unknown) {
      caughtError = e;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((caughtError as any)?.category).toBe("transaction-recovery");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((caughtError as any)?.cause?.message).toContain(
      "injected judgement-ledger failure",
    );

    let subsequentError: unknown;
    try {
      ledger.replay(K);
    } catch (e: unknown) {
      subsequentError = e;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((subsequentError as any)?.category).toBe("unusable");
  });
});

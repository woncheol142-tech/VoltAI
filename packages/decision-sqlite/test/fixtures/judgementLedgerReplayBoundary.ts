import type {
  ImmutableJudgementRecord,
  JudgementLedger,
  ReplayApplicabilityKey,
} from "../../src/judgementLedgerTypes.js";

declare const ledger: JudgementLedger<ImmutableJudgementRecord>;
declare const resolvedKey: ReplayApplicabilityKey;

ledger.replay(resolvedKey);

const rawArtifactAttributes = {
  publisher: "ministry",
  artifactFamily: "KEC",
  revision: "2026",
};

// @ts-expect-error replay accepts only an authority-resolved applicability key
ledger.replay(rawArtifactAttributes);

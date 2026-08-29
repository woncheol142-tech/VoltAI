export type JudgementLedgerErrorCategory =
  | "address"
  | "identity-conflict"
  | "invalid-record"
  | "lifecycle"
  | "schema"
  | "storage"
  | "transaction-recovery"
  | "unusable";

const messages: Record<JudgementLedgerErrorCategory, string> = {
  address: "Judgement ledger address validation failed",
  "identity-conflict": "Judgement ledger record identity conflict",
  "invalid-record": "Judgement ledger record validation failed",
  lifecycle: "Judgement ledger lifecycle validation failed",
  schema: "Judgement ledger schema validation failed",
  storage: "Judgement ledger storage operation failed",
  "transaction-recovery": "Judgement ledger transaction recovery failed",
  unusable: "Judgement ledger connection is unusable",
};

export class JudgementLedgerError extends Error {
  readonly category: JudgementLedgerErrorCategory;

  constructor(
    category: JudgementLedgerErrorCategory,
    options?: { readonly cause?: unknown },
  ) {
    super(messages[category], options);
    this.name = "JudgementLedgerError";
    this.category = category;
  }
}

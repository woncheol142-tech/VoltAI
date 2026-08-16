export type DecisionStoreErrorCategory =
  | "address"
  | "codec-encode"
  | "value-encode"
  | "value-decode"
  | "codec-decode"
  | "identity-conflict"
  | "self-supersession"
  | "schema"
  | "storage"
  | "closed";

export type DecisionStoreErrorField =
  | "namespace"
  | "record-key"
  | "selection"
  | "context"
  | "basis"
  | "superseded-address"
  | "superseding-address"
  | "schema"
  | "database";

const categoryMessages: Record<DecisionStoreErrorCategory, string> = {
  address: "Decision store address validation failed",
  "codec-encode": "Decision store codec encoding failed",
  "value-encode": "Decision store value encoding failed",
  "value-decode": "Decision store value decoding failed",
  "codec-decode": "Decision store codec decoding failed",
  "identity-conflict": "Decision store identity conflict",
  "self-supersession": "Decision store self-supersession is not allowed",
  schema: "Decision store schema validation failed",
  storage: "Decision store storage operation failed",
  closed: "Decision store is closed",
};

export class DecisionStoreError extends Error {
  readonly category: DecisionStoreErrorCategory;
  readonly field?: DecisionStoreErrorField;

  constructor(
    category: DecisionStoreErrorCategory,
    field?: DecisionStoreErrorField,
  ) {
    super(categoryMessages[category]);
    this.name = "DecisionStoreError";
    this.category = category;
    this.field = field;
  }
}

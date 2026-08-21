export type KecRequirementSnapshotErrorCategory =
  | "binding-mismatch"
  | "unsupported-locator-space"
  | "snapshot-conflict"
  | "locator-encode"
  | "locator-decode"
  | "member-corruption"
  | "schema"
  | "storage"
  | "closed"
  | "capture-invalid"
  | "capture-conflict"
  | "capture-corruption"
  | "capture-unsupported-schema";

const messages: Record<KecRequirementSnapshotErrorCategory, string> = {
  "binding-mismatch": "Requirement snapshot member binding mismatch",
  "unsupported-locator-space": "Requirement snapshot locator space unsupported",
  "snapshot-conflict": "Requirement snapshot conflicts with stored population",
  "locator-encode": "Requirement snapshot locator encoding failed",
  "locator-decode": "Requirement snapshot locator decoding failed",
  "member-corruption": "Requirement snapshot member data is corrupt",
  schema: "Requirement snapshot schema validation failed",
  storage: "Requirement snapshot storage operation failed",
  closed: "Requirement snapshot store is closed",
  "capture-invalid": "Source capture snapshot is invalid",
  "capture-conflict": "Source capture snapshot conflicts with stored data",
  "capture-corruption": "Stored source capture data is corrupt",
  "capture-unsupported-schema":
    "Source capture writes require Requirement snapshot schema v2",
};

export class KecRequirementSnapshotStoreError extends Error {
  readonly category: KecRequirementSnapshotErrorCategory;

  constructor(category: KecRequirementSnapshotErrorCategory) {
    super(messages[category]);
    this.name = "KecRequirementSnapshotStoreError";
    this.category = category;
  }
}

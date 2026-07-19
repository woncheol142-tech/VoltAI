import { createHash } from "node:crypto";

export type ElectricalObjectIdentityInput = {
  sourceSha256: string;
  page: number;
  ruleId: string;
  primaryPrimitiveIds: readonly string[];
  supportingPrimitiveIds: readonly string[];
  contextPrimitiveIds: readonly string[];
  labelIds: readonly string[];
};

function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalIds(values: readonly string[], label: string): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`${label} ID must be a non-empty string`);
    }
    if (seen.has(value)) throw new Error(`Duplicate ${label} ID: ${value}`);
    seen.add(value);
  }
  return [...values].sort(codepointCompare);
}

export function createElectricalObjectId(
  input: ElectricalObjectIdentityInput,
): string {
  if (!Number.isInteger(input.page) || input.page < 1) {
    throw new Error("Electrical object page must be a positive integer");
  }
  if (input.ruleId.trim().length === 0) {
    throw new Error("Electrical object ruleId must not be empty");
  }
  const identity = {
    sourceSha256: input.sourceSha256,
    page: input.page,
    ruleId: input.ruleId,
    primaryPrimitiveIds: canonicalIds(input.primaryPrimitiveIds, "primary primitive"),
    supportingPrimitiveIds: canonicalIds(
      input.supportingPrimitiveIds,
      "supporting primitive",
    ),
    contextPrimitiveIds: canonicalIds(input.contextPrimitiveIds, "context primitive"),
    labelIds: canonicalIds(input.labelIds, "label"),
  };
  return createHash("sha256")
    .update(JSON.stringify(identity), "utf8")
    .digest("hex")
    .slice(0, 24);
}

export { codepointCompare };

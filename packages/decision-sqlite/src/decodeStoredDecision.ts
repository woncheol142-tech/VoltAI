import type { DecisionRecord } from "@voltai/knowledge-core";

import {
  decodeDecisionRecordKey,
  validateAddressCoordinate,
} from "./address.js";
import { DecisionStoreError } from "./errors.js";
import { decodeCodecValue, validatePhysicalJsonValue } from "./physicalJson.js";
import type {
  DecisionIdentityNamespace,
  DecisionRecordValueCodecs,
  StoredDecisionRecord,
} from "./types.js";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function decodeStoredDecision<
  TDecisionRecordId extends NonNullable<unknown>,
  TSelection,
  TContext,
>(
  record: StoredDecisionRecord,
  identity: DecisionIdentityNamespace<TDecisionRecordId>,
  codecs: DecisionRecordValueCodecs<TSelection, TContext>,
): DecisionRecord<TDecisionRecordId, TSelection, TContext> {
  if (!isObjectRecord(record) || !isObjectRecord(record.address)) {
    throw new DecisionStoreError("query", "query");
  }

  const namespace = validateAddressCoordinate(
    record.address.namespace,
    "namespace",
  );
  const recordKey = validateAddressCoordinate(
    record.address.recordKey,
    "record-key",
  );
  const selection = validatePhysicalJsonValue(record.selection, "selection");
  const context = validatePhysicalJsonValue(record.context, "context");

  if (namespace !== identity.namespace) {
    throw new DecisionStoreError("query", "namespace-binding");
  }

  return {
    id: decodeDecisionRecordKey(recordKey, identity.keyCodec),
    decision: {
      selection: decodeCodecValue(selection, codecs.selection, "selection"),
      context: decodeCodecValue(context, codecs.context, "context"),
    },
  };
}

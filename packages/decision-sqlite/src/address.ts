import type { DecisionRecordKeyCodec } from "@voltai/knowledge-core";

import { DecisionStoreError, type DecisionStoreErrorField } from "./errors.js";

function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit === 0) {
      return false;
    }

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) {
        return false;
      }

      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        return false;
      }

      index += 1;
      continue;
    }

    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }

  return true;
}

export function validateAddressCoordinate(
  value: unknown,
  field: DecisionStoreErrorField,
): string {
  if (typeof value !== "string" || !isWellFormedUtf16(value)) {
    throw new DecisionStoreError("address", field);
  }

  return value;
}

export function validateNamespace(namespace: unknown): string {
  return validateAddressCoordinate(namespace, "namespace");
}

export function encodeDecisionRecordKey<
  TDecisionRecordId extends NonNullable<unknown>,
>(
  value: TDecisionRecordId,
  codec: DecisionRecordKeyCodec<TDecisionRecordId>,
  field: DecisionStoreErrorField = "record-key",
): string {
  let encoded: unknown;

  try {
    encoded = codec.encode(value);
  } catch {
    throw new DecisionStoreError("codec-encode", field);
  }

  if (typeof encoded !== "string") {
    throw new DecisionStoreError("codec-encode", field);
  }

  return validateAddressCoordinate(encoded, field);
}

export function decodeDecisionRecordKey<
  TDecisionRecordId extends NonNullable<unknown>,
>(
  encoded: string,
  codec: DecisionRecordKeyCodec<TDecisionRecordId>,
): TDecisionRecordId {
  try {
    return codec.decode(encoded);
  } catch {
    throw new DecisionStoreError("codec-decode", "record-key");
  }
}

import type { DecisionValueCodec, JsonValue } from "@voltai/knowledge-core";

import { DecisionStoreError, type DecisionStoreErrorField } from "./errors.js";

type TraversalEntry =
  | { readonly kind: "enter"; readonly value: unknown }
  | { readonly kind: "exit"; readonly value: object };

function failWrite(): never {
  throw new Error("invalid physical JSON value");
}

function validateWriteGraph(root: unknown): void {
  const active = new WeakSet<object>();
  const stack: TraversalEntry[] = [{ kind: "enter", value: root }];

  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) {
      break;
    }

    if (entry.kind === "exit") {
      active.delete(entry.value);
      continue;
    }

    const value = entry.value;
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean"
    ) {
      continue;
    }

    if (typeof value === "number") {
      if (!Number.isFinite(value) || Object.is(value, -0)) {
        failWrite();
      }
      continue;
    }

    if (typeof value !== "object") {
      failWrite();
    }

    if (active.has(value)) {
      failWrite();
    }
    active.add(value);
    stack.push({ kind: "exit", value });

    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        failWrite();
      }

      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1 || !keys.includes("length")) {
        failWrite();
      }

      for (let index = value.length - 1; index >= 0; index -= 1) {
        const key = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (
          descriptor === undefined ||
          descriptor.enumerable !== true ||
          !("value" in descriptor)
        ) {
          failWrite();
        }
        stack.push({ kind: "enter", value: descriptor.value });
      }
      continue;
    }

    if (Object.getPrototypeOf(value) !== Object.prototype) {
      failWrite();
    }

    const keys = Reflect.ownKeys(value);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      if (typeof key !== "string") {
        failWrite();
      }

      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !("value" in descriptor)
      ) {
        failWrite();
      }
      stack.push({ kind: "enter", value: descriptor.value });
    }
  }
}

function physicalJsonText(value: unknown): string {
  validateWriteGraph(value);
  const text = JSON.stringify(value);
  if (typeof text !== "string") {
    failWrite();
  }

  const parsed = JSON.parse(text) as unknown;
  if (JSON.stringify(parsed) !== text) {
    failWrite();
  }

  return text;
}

export function encodePhysicalJson(
  value: unknown,
  field: DecisionStoreErrorField,
): string {
  try {
    return physicalJsonText(value);
  } catch {
    throw new DecisionStoreError("value-encode", field);
  }
}

export function validatePhysicalJsonValue(
  value: unknown,
  field: DecisionStoreErrorField,
): JsonValue {
  try {
    physicalJsonText(value);
    return value as JsonValue;
  } catch {
    throw new DecisionStoreError("value-decode", field);
  }
}

export function encodeCodecValue<TValue>(
  value: TValue,
  codec: DecisionValueCodec<TValue>,
  field: DecisionStoreErrorField,
): string {
  let encoded: unknown;

  try {
    encoded = codec.encode(value);
  } catch {
    throw new DecisionStoreError("codec-encode", field);
  }

  return encodePhysicalJson(encoded, field);
}

export function decodePhysicalJson(
  text: unknown,
  field: DecisionStoreErrorField,
): JsonValue {
  try {
    if (typeof text !== "string") {
      throw new Error("physical value is not TEXT");
    }

    const parsed = JSON.parse(text) as JsonValue;
    if (JSON.stringify(parsed) !== text) {
      throw new Error("physical value is not round-trip stable");
    }

    return parsed;
  } catch {
    throw new DecisionStoreError("value-decode", field);
  }
}

export function decodeCodecValue<TValue>(
  value: JsonValue,
  codec: DecisionValueCodec<TValue>,
  field: DecisionStoreErrorField,
): TValue {
  try {
    return codec.decode(value);
  } catch {
    throw new DecisionStoreError("codec-decode", field);
  }
}

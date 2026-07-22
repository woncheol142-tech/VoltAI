import { codepointCompare } from "./ordering.js";
import type { CircuitJsonObject, CircuitJsonValue } from "./types.js";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isDenseArray(value: readonly unknown[]): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes("length"))
    return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      return false;
    }
  }
  return true;
}

function isDataObject(value: object): boolean {
  if (!isPlainObject(value)) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || FORBIDDEN_KEYS.has(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      return false;
    }
  }
  return true;
}

function isJsonSafeInternal(
  value: unknown,
  ancestors: WeakSet<object>,
): value is CircuitJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;

  if (Array.isArray(value)) {
    if (!isDenseArray(value)) return false;
    ancestors.add(value);
    const valid = value.every((entry) => isJsonSafeInternal(entry, ancestors));
    ancestors.delete(value);
    return valid;
  }
  if (!isDataObject(value)) return false;
  ancestors.add(value);
  const valid = Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor !== undefined &&
      "value" in descriptor &&
      isJsonSafeInternal(descriptor.value, ancestors)
    );
  });
  ancestors.delete(value);
  return valid;
}

export function isCircuitJsonValue(value: unknown): value is CircuitJsonValue {
  try {
    return isJsonSafeInternal(value, new WeakSet());
  } catch {
    return false;
  }
}

export function isCircuitJsonObject(
  value: unknown,
): value is CircuitJsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    isCircuitJsonValue(value)
  );
}

export function assertCircuitJsonValue(
  value: unknown,
  label = "value",
): asserts value is CircuitJsonValue {
  if (!isCircuitJsonValue(value)) {
    throw new Error(`${label} must be JSON-safe`);
  }
}

export function canonicalizeCircuitJsonValue(
  value: CircuitJsonValue,
): CircuitJsonValue {
  assertCircuitJsonValue(value);
  if (Array.isArray(value)) return value.map(canonicalizeCircuitJsonValue);
  if (typeof value === "number") return Object.is(value, -0) ? 0 : value;
  if (typeof value !== "object" || value === null) return value;
  const objectValue = value as CircuitJsonObject;
  const entries = Object.keys(objectValue)
    .sort(codepointCompare)
    .map(
      (key) => [key, canonicalizeCircuitJsonValue(objectValue[key]!)] as const,
    );
  return Object.fromEntries(entries);
}

export function deepFreezeCircuitValue<T>(
  value: T,
  seen = new WeakSet<object>(),
): T {
  if (typeof value !== "object" || value === null || seen.has(value))
    return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) {
      deepFreezeCircuitValue(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

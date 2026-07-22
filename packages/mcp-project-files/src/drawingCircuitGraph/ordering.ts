export function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalUniqueStrings(
  values: readonly string[],
  label: string,
  options: { allowEmpty?: boolean } = {},
): string[] {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array`);
  if (!options.allowEmpty && values.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  if (!values.every((value) => typeof value === "string" && value.length > 0)) {
    throw new Error(`${label} must contain non-empty strings`);
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicate values`);
  }
  return [...values].sort(codepointCompare);
}

export function isCanonicalUniqueStrings(
  values: readonly string[],
  options: { allowEmpty?: boolean } = {},
): boolean {
  try {
    const canonical = canonicalUniqueStrings(values, "values", options);
    return canonical.every((value, index) => value === values[index]);
  } catch {
    return false;
  }
}

export function compareById<T>(
  left: T,
  right: T,
  getId: (value: T) => string,
): number {
  return codepointCompare(getId(left), getId(right));
}

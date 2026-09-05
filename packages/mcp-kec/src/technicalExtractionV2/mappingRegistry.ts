export interface KecV2MappingEntry {
  readonly fontFingerprint: string;
  readonly sourceCodePoint: number;
  readonly mappedText: string;
  readonly mappingId: string;
  readonly evidenceDigest: string;
}

export interface KecV2MappingRegistry {
  readonly version: string;
  readonly digest: string;
  readonly entries?: readonly KecV2MappingEntry[];
}

export interface ValidatedKecV2MappingRegistry {
  readonly value: KecV2MappingRegistry;
  readonly find: (
    fontFingerprint: string,
    sourceCodePoint: number,
  ) => KecV2MappingEntry | undefined;
}

export class InvalidKecV2MappingRegistry extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidKecV2MappingRegistry";
  }
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function validatedEntry(value: unknown, index: number): KecV2MappingEntry {
  if (
    !isRecord(value) ||
    !sha256(value.fontFingerprint) ||
    !Number.isSafeInteger(value.sourceCodePoint) ||
    (value.sourceCodePoint as number) < 0 ||
    (value.sourceCodePoint as number) > 0x10ffff ||
    !nonEmptyString(value.mappedText) ||
    !nonEmptyString(value.mappingId) ||
    !sha256(value.evidenceDigest)
  ) {
    throw new InvalidKecV2MappingRegistry(
      `mapping registry entry ${index} is malformed`,
    );
  }
  return Object.freeze({
    fontFingerprint: value.fontFingerprint,
    sourceCodePoint: value.sourceCodePoint as number,
    mappedText: value.mappedText,
    mappingId: value.mappingId,
    evidenceDigest: value.evidenceDigest,
  });
}

function entryKey(fontFingerprint: string, sourceCodePoint: number): string {
  return `${fontFingerprint}:${sourceCodePoint.toString(16)}`;
}

export function validateKecV2MappingRegistry(
  value: unknown,
): ValidatedKecV2MappingRegistry {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.version) ||
    !sha256(value.digest) ||
    (value.entries !== undefined && !Array.isArray(value.entries))
  ) {
    throw new InvalidKecV2MappingRegistry(
      "mapping registry version, sha-256 digest, and entry collection are invalid",
    );
  }

  const entries = Object.freeze(
    (value.entries ?? []).map((entry, index) => validatedEntry(entry, index)),
  );
  const byKey = new Map<string, KecV2MappingEntry>();
  for (const entry of entries) {
    const key = entryKey(entry.fontFingerprint, entry.sourceCodePoint);
    if (byKey.has(key)) {
      throw new InvalidKecV2MappingRegistry(
        `mapping registry has conflicting entries for ${key}`,
      );
    }
    byKey.set(key, entry);
  }

  const registryValue: KecV2MappingRegistry = Object.freeze({
    version: value.version,
    digest: value.digest,
    ...(entries.length === 0 ? {} : { entries }),
  });
  return Object.freeze({
    value: registryValue,
    find: (fontFingerprint: string, sourceCodePoint: number) =>
      byKey.get(entryKey(fontFingerprint, sourceCodePoint)),
  });
}

export type KecExistingIndexState = Readonly<{
  metadata: Readonly<{
    "embedding\u0050rovider": string;
    embeddingModel: string;
    dimensions: number;
  }> | null;
  sourcePaths: readonly string[];
}>;

export type KecIncomingEmbeddingState = Readonly<{
  sourcePath: string;
  providerMetadata: Readonly<{
    provider: string;
    model: string;
  }>;
  vectors: readonly (readonly number[])[];
}>;

export type KecIndexWriteCompatibility = Readonly<{
  dimension: number;
}>;

const compatibilityErrors = {
  invalidEmbedding: "KEC_INDEX_COMPATIBILITY: INVALID_EMBEDDING",
  invalidProviderMetadata: "KEC_INDEX_COMPATIBILITY: INVALID_PROVIDER_METADATA",
  invalidSourcePath: "KEC_INDEX_COMPATIBILITY: INVALID_SOURCE_PATH",
  missingIndexMetadata: "KEC_INDEX_COMPATIBILITY: MISSING_INDEX_METADATA",
  invalidIndexMetadata: "KEC_INDEX_COMPATIBILITY: INVALID_INDEX_METADATA",
  providerMismatch: "KEC_INDEX_COMPATIBILITY: PROVIDER_MISMATCH",
  modelMismatch: "KEC_INDEX_COMPATIBILITY: MODEL_MISMATCH",
  dimensionMismatch: "KEC_INDEX_COMPATIBILITY: DIMENSION_MISMATCH",
} as const;

const existingProviderKey = "embedding\u0050rovider";

type CompatibilityError =
  (typeof compatibilityErrors)[keyof typeof compatibilityErrors];

type OwnDataProperty =
  Readonly<{ found: true; value: unknown }> | Readonly<{ found: false }>;

function fail(message: CompatibilityError): never {
  throw new Error(message);
}

function readOwnDataProperty(
  value: unknown,
  key: PropertyKey,
): OwnDataProperty {
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null
  ) {
    return { found: false };
  }

  const descriptor = Object.getOwnPropertyDescriptor(value, key);

  if (!descriptor || !("value" in descriptor)) {
    return { found: false };
  }

  return { found: true, value: descriptor.value };
}

function requireOwnDataProperty(
  value: unknown,
  key: PropertyKey,
  error: CompatibilityError,
): unknown {
  const property = readOwnDataProperty(value, key);

  if (!property.found) {
    fail(error);
  }

  return property.value;
}

function validateVectors(incoming: unknown): number {
  const vectors = requireOwnDataProperty(
    incoming,
    "vectors",
    compatibilityErrors.invalidEmbedding,
  );

  if (!Array.isArray(vectors) || vectors.length === 0) {
    fail(compatibilityErrors.invalidEmbedding);
  }

  let dimension: number | undefined;

  for (let vectorIndex = 0; vectorIndex < vectors.length; vectorIndex += 1) {
    const vectorProperty = readOwnDataProperty(vectors, vectorIndex);

    if (!vectorProperty.found || !Array.isArray(vectorProperty.value)) {
      fail(compatibilityErrors.invalidEmbedding);
    }

    const vector = vectorProperty.value;

    if (
      vector.length === 0 ||
      !Number.isSafeInteger(vector.length) ||
      (dimension !== undefined && vector.length !== dimension)
    ) {
      fail(compatibilityErrors.invalidEmbedding);
    }

    dimension ??= vector.length;

    for (let valueIndex = 0; valueIndex < vector.length; valueIndex += 1) {
      const valueProperty = readOwnDataProperty(vector, valueIndex);

      if (
        !valueProperty.found ||
        typeof valueProperty.value !== "number" ||
        !Number.isFinite(valueProperty.value)
      ) {
        fail(compatibilityErrors.invalidEmbedding);
      }
    }
  }

  if (
    dimension === undefined ||
    !Number.isSafeInteger(dimension) ||
    dimension < 1
  ) {
    fail(compatibilityErrors.invalidEmbedding);
  }

  return dimension;
}

function validateIncomingProviderMetadata(
  incoming: unknown,
): Readonly<{ provider: string; model: string }> {
  const metadata = requireOwnDataProperty(
    incoming,
    "providerMetadata",
    compatibilityErrors.invalidProviderMetadata,
  );
  const provider = requireOwnDataProperty(
    metadata,
    "provider",
    compatibilityErrors.invalidProviderMetadata,
  );
  const model = requireOwnDataProperty(
    metadata,
    "model",
    compatibilityErrors.invalidProviderMetadata,
  );

  if (
    typeof provider !== "string" ||
    provider.length === 0 ||
    typeof model !== "string" ||
    model.length === 0
  ) {
    fail(compatibilityErrors.invalidProviderMetadata);
  }

  return { provider, model };
}

function validateSourcePaths(
  existing: unknown,
  incoming: unknown,
): Readonly<{ incomingSourcePath: string; sourcePaths: readonly string[] }> {
  const incomingSourcePath = requireOwnDataProperty(
    incoming,
    "sourcePath",
    compatibilityErrors.invalidSourcePath,
  );
  const sourcePaths = requireOwnDataProperty(
    existing,
    "sourcePaths",
    compatibilityErrors.invalidSourcePath,
  );

  if (typeof incomingSourcePath !== "string" || !Array.isArray(sourcePaths)) {
    fail(compatibilityErrors.invalidSourcePath);
  }

  const validatedSourcePaths: string[] = [];

  for (let index = 0; index < sourcePaths.length; index += 1) {
    const sourcePath = readOwnDataProperty(sourcePaths, index);

    if (!sourcePath.found || typeof sourcePath.value !== "string") {
      fail(compatibilityErrors.invalidSourcePath);
    }

    validatedSourcePaths.push(sourcePath.value);
  }

  return { incomingSourcePath, sourcePaths: validatedSourcePaths };
}

function validateExistingMetadata(existing: unknown): Readonly<{
  provider: string;
  model: string;
  dimension: number;
}> {
  const metadata = requireOwnDataProperty(
    existing,
    "metadata",
    compatibilityErrors.missingIndexMetadata,
  );

  if (metadata === null) {
    fail(compatibilityErrors.missingIndexMetadata);
  }

  const provider = requireOwnDataProperty(
    metadata,
    existingProviderKey,
    compatibilityErrors.invalidIndexMetadata,
  );
  const model = requireOwnDataProperty(
    metadata,
    "embeddingModel",
    compatibilityErrors.invalidIndexMetadata,
  );
  const dimension = requireOwnDataProperty(
    metadata,
    "dimensions",
    compatibilityErrors.invalidIndexMetadata,
  );

  if (
    typeof provider !== "string" ||
    provider.length === 0 ||
    typeof model !== "string" ||
    model.length === 0 ||
    typeof dimension !== "number" ||
    !Number.isSafeInteger(dimension) ||
    dimension < 1
  ) {
    fail(compatibilityErrors.invalidIndexMetadata);
  }

  return { provider, model, dimension };
}

export function assertKecIndexWriteCompatibility(
  existing: KecExistingIndexState,
  incoming: KecIncomingEmbeddingState,
): KecIndexWriteCompatibility {
  const dimension = validateVectors(incoming);
  const incomingMetadata = validateIncomingProviderMetadata(incoming);
  const { incomingSourcePath, sourcePaths } = validateSourcePaths(
    existing,
    incoming,
  );
  const hasForeignSource = sourcePaths.some(
    (sourcePath) => sourcePath !== incomingSourcePath,
  );

  if (!hasForeignSource) {
    return { dimension };
  }

  const existingMetadata = validateExistingMetadata(existing);

  if (existingMetadata.provider !== incomingMetadata.provider) {
    fail(compatibilityErrors.providerMismatch);
  }

  if (existingMetadata.model !== incomingMetadata.model) {
    fail(compatibilityErrors.modelMismatch);
  }

  if (existingMetadata.dimension !== dimension) {
    fail(compatibilityErrors.dimensionMismatch);
  }

  return { dimension };
}
